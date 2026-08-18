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
| The shop | The grid gates on a postcode and badges every toy with the resolved shop's own answer, exactly as the storefront does. The same postcodes work: 01310100, 90010150 |
| Product | Availability at the resolved shop, the substitute card when the shop cannot supply the toy, add to basket. Showing the unavailable answer writes the `rh_availability_events` row that Use Case 1's segment reads |
| Inbox | The messages Dengage holds for this device. Opening reports the click. Dismissing hides locally and never deletes from the shared account |
| Debug | Device id, push token, contact key, which shop answered and whether the live endpoint or a stored answer produced it, and every SDK call this launch, as sent, not as stored |

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
