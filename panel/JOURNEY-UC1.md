# Use Case 1 in the platform: segment, email, journey

The manual send proved the pieces. This is the structure that runs them without
anyone pressing anything: a person browses, they land in a segment, a journey
sends them the email, and the email adapts to what they did.

**One email, not three.** It branches at render into in stock, substitute, or
say-nothing, so both journeys below point at the same creative. That is worth
saying out loud in the room: one creative, two entry points, correct every time.

---

## What has to exist first, and why

### A Big Data Table, `rh_availability_events`

**Not blocking, and an earlier revision of this file was wrong to say it was.**
The email that Ri Happy receive can be produced today with no new table at all,
using `page_view_events` and `$blockSend`. What the table buys is an audience
that exists as an audience. [The alternatives, and why this one](#could-the-tables-we-already-have-do-this)
sets out the whole comparison.

The storefront already fires `rh_substitution_shown` when a visitor is shown a
replacement. That is an on-site trigger and **nothing else**: `scenario()`
reaches `dataLayer` and a window event and never leaves the browser. It drives
widgets, not audiences, so no segment can be built on it however clearly it
shows in the debug readout.

So the storefront now also writes a stored row through `sendDeviceEvent`, the
same mechanism the wishlist uses. A real row, captured from the live site:

```json
{
  "product_id": "100184971",
  "store_id": "poa-praia-de-belas",
  "store_name": "Ri Happy Praia de Belas Prime Offices",
  "cep": "90010150",
  "state": "withoutStock",
  "price": 99.99,
  "substitute_id": "1002111906",
  "substitute_reason": "same_licence",
  "event_id": "b4a430c7-1491-4d77-a0ff-2715c7ebc72a",
  "event_type": "unavailable",
  "is_used": false
}
```

Columns to create:

| Column | Type | Note |
|---|---|---|
| `key` | text | the SDK fills it |
| `event_date` | timestamp | the SDK fills it |
| `event_id` | text | we set it, required for the row to store |
| `event_type` | text | `unavailable`, we set it, required |
| `is_used` | boolean | we set it, required |
| `product_id` | text | the toy they wanted |
| `store_id` | text | the shop that could not supply it |
| `store_name` | text | for the message, so it need not be looked up |
| `cep` | text | the postcode they browsed under |
| `state` | text | `withoutStock` |
| `price` | **decimal** | not integer. The row carries `99.99`, and an integer column rounds or rejects it |
| `substitute_id` | text | what was offered instead |
| `substitute_reason` | text | `same_licence`, `same_age_and_shelf`, `same_shelf`, `nearby_price` |

**One relation, to `master_device`.** An earlier revision of this file asked for
a second one to `master_contact` and that was wrong. The Star Schema keeps
`master_contact` and `master_device` as its two centres, joined by
`master_device.contact_key`, which is nullable so that anonymous devices exist.
The six standard event tables all hang off `master_device`, and a contact is
reached through the device rather than directly. Dengage describe this as
"N-level relations while keeping master_contact and master_device as the central
connection points", which is why segment A can still be built as a Table Filter
from a table that never touches `master_contact` itself.

The relation is also what makes the table work at all: the SDK reference
requires one for any Big Data Table written by `sendDeviceEvent`, and without it
the call is accepted, returns 200, and the row is discarded.

**Get the column pair by copying, not by reading.** Dengage's Star Schema page
does not describe the event tables at all, so the pairing is not something to
reason out. Open the relation that already exists on `page_view_events` in
Data Space > schema, and mirror it. Five sibling tables already carry the
connection this table needs, and Dengage made all five.

The `key` column is **the device id, on every row, signed in or not.** This file
said it was the contact key when identified, which was inferred from the
column's name and disproved on 17 August by a send that found nothing under
`salil-demo` while that contact's rows sat under a device uuid.

Until the table exists the call is **accepted and dropped**, which looks
identical to success from the browser. Confirm the row in Data Space, never the
200.

**And give it time before calling it dropped.** A device appears in Profiles
within seconds, and a stored row does not. Dropped and not yet ingested look
identical until something later shows up beside it, so a missing row on the
afternoon you made it is not evidence of anything.

How long is not known. `session_info` was still empty of the afternoon's
sessions several hours after them on 17 August 2026, and an earlier estimate of
three hours in this file was one measurement that then failed to hold. It is
recorded as unknown rather than as a number, because a number nobody has
measured twice is what sends the next person looking for a defect that is not
there. **Nothing in Use Case 1 reads `session_info`**, so this is a question
about how to verify, never a dependency.

### Could the tables we already have do this?

Asked on 17 August 2026, and worth the answer being written down, because three
of the four alternatives are more attractive than they turn out to be.

**The moment has three facts in it**: who, which toy, and **what the shop that
would actually serve them answered**. The first two are already in
`page_view_events`, which carries `key` and `product_id`. The third has no
column anywhere in the six, and columns cannot be added to them.

| Route | Verdict |
|---|---|
| `stock_count` on `page_view_events` | **No.** `rh_store_stock` holds a state, `available` or `withoutStock`, and no counts at all, so a number there would be invented. It is also a shared column whose meaning is catalogue-wide stock for every other demo writing it |
| `page_url` | **Nearly.** It already carries `cep=`, and the answer could be stamped in beside it. Two things stop it: `pageView` fires at boot, before the shop resolves, so the first product view has no postcode in its URL at all; and a segment on it needs a `contains` operator on `page_url`, which Dengage's published operator examples do not include |
| `page_type` | **No.** It takes free text in practice, but inventing a value writes a private vocabulary into a table five live demo sites share |
| A Remote Table over Supabase | **No.** The remote table reference lists Oracle, BigQuery, MSSQL, Azure SQL Data Warehouse and Redshift. Postgres is not among them, and the feature needs the Relational Database licence |
| A Remote Segment over Supabase | **Possible, and more work.** Remote Segments do support PostgreSQL and can be a flow audience. But Supabase knows every availability fact and does not know who browsed what: `rh_offer` is `stable`, which it has to be for PostgREST to allow a GET, so it cannot log. The remote route is therefore a new logging endpoint, a new table, and a Remote Source someone has to configure, in place of one Data Space table |

**And the route that genuinely needs nothing new.** Segment on `Product Viewed`
from `page_view_events`, and let the email do the availability check and
`$blockSend` when the shop has the toy. The person who receives an email is
exactly the same person either way.

What that version cannot do is show the audience as an audience. The panel would
report everyone who looked at a toy, most of whom are then silently blocked, so
there is no honest number to cap on, report on or put on screen. It also spends a
Custom API call per recipient to decide not to send. The stored row is what turns
"we suppressed the ones who were fine" into "this many people hit the problem
today", and on the 24th that is the sentence worth being able to say.

So: build the table, and know that it is an improvement rather than a
prerequisite. If it is not ready in time, the `$blockSend` version ships and the
demo still works.

### The email

`panel/email/uc1-store-availability.html`, pasted into **Content > Email > Code
Editor**. Both journeys use this one creative.

**Proven end to end on 17 August 2026**, on two contacts. `RH-1`, clean, one
device, and `salil-demo`, six years old, 25 devices. Both resolved Porto Alegre
from the contact's own last visit, reported the Titan Hero as absent from Praia
de Belas, and offered the Amazing Friends figure from the same range at
R$ 87,99. The footer prints which path resolved the shop, how it reached the
page views, and the contact key the send ran under, so a bad send explains
itself rather than needing another round.

---

## The two segments

### A. Wanted something their shop could not supply

The primary one, and the reason the table above exists. These are people who hit
Ri Happy's actual problem, so the email always has a substitute to offer and
never reads as a generic browse reminder.

- **Type**: Interactive
- **Filter**: **Relational DB > Table Filter**, on `rh_availability_events`
- **Occurrence**: at least 1
- **Time**: in the last 1 day
- Turn on **Enable Real-time Segment Sync** if this is ever used on-site as well.
  Ten real-time segments is the account limit, so spend one only if needed.

**Table Filter, not User Event.** An earlier revision of this file said User
Event, which is the wrong screen. User Event reads Event Definitions, which are
built on the six standard tables. A Big Data Table joins the Star Schema through
the relation you created and is reached under Relational DB instead. If the
panel does turn out to offer this table as an event source as well, either is
fine, but Table Filter is what the relation was made for.

**THE VISITOR HAS TO BE SIGNED IN WHEN THE ROW IS WRITTEN, and this is the one
way to build a segment that is correct and still selects nobody.** The row's
`key` is a device id, always. A contact is reached from it through
`master_device.contact_key`, and that column is null for an anonymous device. So
a substitution seen while signed out produces a real, correct row that no
segment can ever attribute to a person. Browse with `?ck=` in the address, or
sign in first, every time you generate rows for this.

### B. Viewed any product

Broader, and useful as a second scene showing the same creative adapting to a
different entry.

- **Type**: Interactive
- **Filter**: User Event on `page_view_events`, `page_type` equals `product`
- **Occurrence**: at least 1
- **Time**: in the last 1 day

Both segments are re-evaluated on every run of the campaign, so nobody has to
refresh anything by hand.

---

## The journey

**Campaigns > Flow Campaigns > New > Recurring Campaign.**

| Step | Setting |
|---|---|
| 1 | Name: `RH UC1 store availability` |
| 2 | Trigger: **Trigger Externally** |
| 3 | Audience node: Segment, choose **A** (repeat later with **B**) |
| 4 | Entry Capping: on, **1 per day** per contact |
| 5 | Channel node: Email, choose the UC1 content |
| 6 | Add an **End** node on every path |
| 7 | Test, save, publish |

### Why Trigger Externally rather than Periodically

The shortest documented recurrence is **hourly**. Daily can run "every few
hours" and the docs show no minute-level option, so a periodic flow would land
the email up to an hour after somebody browsed. That is unusable on a call, and
close to the overnight pre-build pattern the requirements document explicitly
rejects.

**Trigger Externally** solves it: the campaign runs when another flow fires it
with the **Fire Campaign** action, and that flow can be started by the
`TriggerAutomatedFlow` API. So the same published journey serves both the live
demo and a scheduled production rhythm, without being rebuilt.

For the 24th that means: the person browses, the flow is fired, the email
arrives in seconds, and nothing about the structure is a demo shortcut.

### Entry capping matters more than it looks

Rehearsing means browsing the same toy repeatedly. Without a cap the same
contact re-enters on every run and receives the email each time, which is
noticeable on a shared screen. One per day per contact.

---

## Order to build it in

1. **Create `rh_availability_events`**, with `price` as a decimal and its
   `master_device` relation copied from `page_view_events`. Segment A waits on
   it. Nothing else does.
2. Browse a toy Porto Alegre cannot supply, then confirm one row landed.
3. Paste the email. Send it once manually to confirm it renders.
4. Build segment A. Confirm it has exactly the contact who browsed.
5. Build the recurring campaign against A, Trigger Externally, published.
6. Fire it and confirm the email arrives.
7. Repeat 4 and 5 for segment B, pointing at the same email.

Steps 1 to 3 can be done in one sitting and prove the whole chain. Steps 4 to 7
are then mechanical.

---

## What is still unproven, stated plainly

**The `$from` read inside the email.** It reads the contact's last page view to
find the postcode and the toy. `factory/phase0/SCHEMA.md` confirms the column
names are `key` and `event_date`, which is what the template uses, but the read
itself has not run in a real send. The template falls through to
`nearest_store` and then to a default if it fails, and prints which path fired
in its footer, so the first send answers this rather than failing on it.

**Whether `TriggerAutomatedFlow` can be called from our side.** The `http`
extension is installed on the database, so the call is possible without new
infrastructure and would originate from a server rather than a browser, which
gives an address to whitelist. It needs a Dengage API key, and Supabase only
pins a static egress address on some plans. Not needed for the recurring path
above; needed if we want the instant version.
