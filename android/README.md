# The companion app

The mobile half of the demo: the same catalogue, the same shop logic and the
same Dengage account as the storefront, plus the two things only a phone can
show, push notifications and geofence triggers. It is a complete Android
Studio project, built and installed from Android Studio rather than shipped
as an APK.

## Build and install

1. Clone this repository.
2. In Android Studio, **Open** the `android/` folder (this folder, not the
   repository root).
3. Let Gradle sync. Every version is pinned, so the sync downloads exactly
   what CI verified.
4. Connect the phone, press **Run**.

The application id is `com.dengageecomm.demo`, registered in the Firebase
project `dengageecomm`, and `app/google-services.json` in this repository is
that registration. The Pages workflow refuses to publish it to the demo site,
and it is client configuration rather than a secret, the same way the web
SDK's application guid is visible in the storefront's page source.

## What each screen is for

| Screen | What it proves |
|---|---|
| The shop | The grid gates on a postcode and badges every toy with the resolved shop's own answer, exactly as the storefront does. Search fires a search event per settled query, the department chips fire category page views, and the top of the screen carries the App Stories row and an inline in-app slot, both panel driven. The same postcodes work: 01310100, 90010150 |
| Product | Availability at the resolved shop, the substitute card when the shop cannot supply the toy, save to wishlist, add to basket. Showing the unavailable answer writes the `rh_availability_events` row that Use Case 1's segment reads |
| Basket | The rest of the order vocabulary: viewCart on open, removeFromCart per line, beginCheckout, a real order with real lines and a real total, and cancelOrder on the undo |
| Inbox | The messages Dengage holds for this device. Opening reports the click, mark all read reports every receipt. Dismissing hides locally and never deletes from the shared account |
| Debug | Device id, push token, contact key, every permission state, which shop answered and from where, the SDK's own test page, the last push payload, and every SDK call this launch, as sent, not as stored |

## Every Dengage mobile capability, and where this app stands on each

The SDK surface was read from the 6.0.99 sources, not assumed. One file
talks to Dengage, `DengageGateway.kt`; two more implement extension points
the SDK itself invokes, `PushNotificationReceiver` for carousel rendering
and `OrderLiveUpdateHandler` for Live Updates.

| Capability | State in this app |
|---|---|
| Push, text and rich | Working out of the box through `FcmMessagingService`. The notification channel carries the app's name |
| Push action buttons | Handled by the SDK automatically; no app code is required or present |
| Carousel push | Wired: `PushNotificationReceiver` plus the `den_carousel_*` layouts render it, and the manifest receiver keeps the arrows working after the process dies. Author it as a carousel message in the panel |
| Live Updates | Wired for activity type `order_status`: a push whose data carries `live_notification` starts, updates and ends a persistent order status notification with an optional progress bar. This is the Android counterpart of what iOS calls a Live Activity. The payload contract is documented in `OrderLiveUpdateHandler.kt` |
| Live Activity by that name | iOS only, ActivityKit. It does not exist on Android; Live Updates above are the equivalent surface |
| In-app messages | Wired on every screen through `setNavigation`, with screen names `home`, `product`, `cart`, `inbox`, `debug` for targeting |
| Real time in-app | Wired beside it through `showRealTimeInApp`, with comparison data kept fresh: city from the resolved shop, category path from the viewed toy, cart item count and amount from the basket. `setCart` is deliberately not used: its price fields are integers and these prices do not round honestly |
| In-app device info | The resolved shop's name, id and postcode are set, so a message template can print the person's own shop with `dnInAppDeviceInfo.store_name` |
| In-app inline | An `InAppInlineElement` sits on the home screen, property id `rh-home-inline`, hidden until a panel campaign targets it |
| App Stories | A `StoriesListView` sits on the home screen, property id `rh-home-stories`, hidden until a panel campaign targets it |
| App Inbox | Wired with the inbox API this SDK version ships: list, open with click report, mark all read. Delete is withheld on purpose, the shared account rule |
| Geofence | Monitoring starts with the app; permissions are requested from the debug screen; clusters are panel work, `../panel/geofence/` |
| eCommerce events | The full vocabulary fires from real actions: page views for home, product, category and cart, add and remove cart, viewCart, beginCheckout, order, cancelOrder, search on settled queries, wishlist add and remove |
| Custom device events | `rh_availability_events` rows, the same field set the storefront writes |
| Contact key | Verbatim sign in, same key as the web makes the same person |
| Tags | The device tags itself `app = rh-demo` at start, so the panel can target exactly the devices running this app |
| Permissions | Notification and the two step location flow prompted from the debug screen; user, tracking and location permission states all reported there |
| SDK test page | One tap on the debug screen opens Dengage's own diagnostics activity |
| Rating dialog | On the debug screen. Play usually declines to show it on a sideloaded debug build, and the call log says which happened |
| RFM | Available in the SDK (`categoryView`, `saveRFMScores`, `sortRFMItems`) and not used: it sorts local content by scores, and this catalogue's ordering is the storefront's. Documented so nobody mistakes absence for ignorance |
| Huawei HMS | Deliberately excluded: the demo phone is Google services hardware |
| Adjust sync | Deliberately excluded: no attribution SDK belongs in a demo app |

Sign in from the menu. The contact key is passed to Dengage exactly as typed,
so using the same `DPS-` key as on the storefront makes the phone and the
browser the same person in the panel.

## The deeplink

`rhdemo://store/<store_id>` opens the app scoped to that shop. It is the
target a geofence push carries. To try it without a push:

```bash
adb shell am start -a android.intent.action.VIEW -d "rhdemo://store/poa-praia-de-belas"
```

## What the app talks to

| Surface | Where it is defined |
|---|---|
| Catalogue | the published demo site's `products.json`, produced by `tools/build-products.mjs` |
| Shop answer | the same `rh_offer` endpoint the storefront calls, with the same stored answers behind it when the live call does not come back |
| Dengage | `DengageGateway.kt`, and nowhere else. One file owns every SDK call, mirroring the storefront's single event module, because the event tables are shared with live demo sites and one auditable surface is what keeps a wrong row impossible to write quietly |

## The integration key

`gradle.properties` holds the Dengage Mobile App Integration Key exactly as
the panel displays it. The panel escapes some characters in what it shows
(`_s_l_` for a slash, `_p_l_` for a plus, `_e_q_` for an equals), and the
verbatim form is used deliberately: it is the value the panel handed over,
and device registration is the only test of it that matters.

If the debug screen never shows a device id after a launch with the network
up, the escaped form is the first suspect: decode it (replace `_s_l_` with
`/`, `_p_l_` with `+`, `_e_q_` with `=`), put the decoded value into
`gradle.properties`, rebuild, and check the debug screen again.

## Push and geofence, the parts that live in the panel

The app is ready for both; the panel side has its own steps, tracked in
`factory/panel/README.md` in the demo factory repository:

- The Firebase **service account key** must be uploaded to the Dengage
  application definition, or the panel can send nothing to this app.
- Geofence **clusters** are defined in Data Space, Geofence, and campaigns
  under Targeting Campaigns, Geofencing. The app starts monitoring at launch;
  with no clusters defined that is a no-op, so defining them requires no app
  change.
- On the phone, grant notification permission and both location permissions
  from the **Debug** screen, in the order it presents them. Background
  location must end at "Allow all the time" for triggers while the app is
  closed.

## Verifying, honestly

The debug screen reports what the app SENT. The row in Data Space is the only
proof an event landed: an accepted call and a stored row are different facts,
and the difference has cost this project two diagnoses. After a rehearsal,
confirm the rows, not the log.
