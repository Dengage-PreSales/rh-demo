# Geofences for the shop network

`store-geofences.csv` is ready to upload: one geofence per fulfilling shop,
124 rows, built from `web/stores.json` by taking every shop that is pickup
enabled and carries coordinates. Shops whose collection option their own
checkout never offered are left out, the same filter the storefront applies,
so a fence never fires for a shop the demo would then refuse to resolve.

## Creating the cluster

1. **Data Space > Geofence > + New.**
2. Name the cluster `RH shop network`, Next.
3. **Import from CSV**, upload `store-geofences.csv`.
4. Save, and use **Sync Now** after any later edit so devices refresh at
   once rather than on the six hour cycle.

Before uploading, download the **Sample File** on the import screen and
compare its `Radius` and `MeasureType` values against this file. The columns
here follow the documented structure (`GeofenceName`, `Longitude`,
`Latitude`, `Radius`, `MeasureType`) with a radius of `0.2` `Km`. If the
sample expresses radius another way, adjust the two columns to match the
sample: the column structure is fixed and the sample file is the authority.

## Why 200 metres

Dengage's radius guidance puts a shop inside a shopping centre at 150 to
300 m: below 100 m fences are frequently missed, and the fence should cover
the building rather than the shop floor, because indoor accuracy falls to
hundreds of metres. 200 m sits in the reliable band without reaching the
next block.

Five pairs sit closer together than the recommended two-radius spacing, four
of them at identical coordinates because a Ri Happy and a PBKIDS share the
same shopping centre:

| Distance | Pair |
|---|---|
| 0 m | PBKIDS BH SHOPPING and Ri Happy BH Shopping |
| 0 m | PBKIDS RIOMAR FORTALEZA and Ri Happy RioMar Fortaleza |
| 0 m | PBKIDS RIOMAR RECIFE and Ri Happy RioMar Shopping Recife |
| 0 m | PBKIDS SHOPPING RECIFE and Ri Happy Shopping Recife |
| 276 m | Ri Happy Norte Shopping and Ri Happy Otto Baumgart |

Overlapping fences produce ambiguous transitions and duplicate looking
notifications, so if the campaign targets the whole network, keep one fence
per shopping centre and delete the PBKIDS twin from the cluster after
import. They are left in the file because which banner to keep is a choice,
not a fact.

## The rehearsal cluster

Create a second cluster, `RH rehearsal`, with a single fence at the address
where the demo will be rehearsed and presented. It stays separate from the
shop network on purpose: the rehearsal campaign can then be aimed at one
fence that actually gets walked through, without 124 real shops in the same
audience.

**This cluster cannot be created yet.** It needs the rehearsal address or
coordinates, which only Salil can supply. The app's debug screen carries the
same note, so the gap is visible from the phone as well as from this file.
Radius guidance for a walk test: 150 to 300 m, and enter the fence from
clearly outside it, because a fence registered while already inside fires
its enter event immediately, which looks like a false positive mid-demo.

## The campaign

Campaigns live under **Targeting Campaigns > Geofencing** and connect push
content, a trigger type and one or more clusters. Two things the campaign
builder does not say out loud:

- The content must be **transactional push content**, not marketing push.
  The deeplink to put in it is `rhdemo://store/<store_id>`, which opens the
  app already scoped to the shop whose fence fired.
- **Enter** is the trigger for the walk-past scenario. Dwell needs 300 m or
  more of radius and is unreliable on a phone that goes straight past.

On the phone, the app requests notification permission and both location
steps from its debug screen. Background location must end at "Allow all the
time", or fences are only monitored while the app is open, which defeats
the scenario.
