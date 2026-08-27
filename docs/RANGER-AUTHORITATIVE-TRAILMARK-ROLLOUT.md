# Ranger Atlas Official Locations and Discord Rollout

## Status

The additive Supabase migrations have been applied to Ranger production. The
browser client described here is ready for the GitHub Pages rollout; publishing
newer calibration revisions can continue after that rollout without replacing
or resetting the authoritative location data.

The migrations are additive. They do not delete the existing Guild Atlas,
shares, visits, drops, profiles, or device links. The current production site
can continue using the existing schema while the new tables and functions are
tested.

## What Changes

### Official Trailmarks

- Official Trailmarks live in `atlas_official_trailmarks`, independently of the
  mutable `GUILD` payload.
- Every client receives the active official Trailmarks automatically. They do
  not need to receive the Guild Atlas again.
- Clearing, replacing, importing, or sharing a personal Atlas cannot remove or
  duplicate the official Trailmark layer.
- Every create, edit, move, retire, recovery, and restore operation creates a
  revision in `atlas_official_trailmark_revisions`.
- Current Trailmarks found in the Guild Atlas are promoted automatically when
  the migration runs.
- Older Trailmarks found only in archived Guild Atlas revisions are retained as
  inactive recovery candidates. A Marshal must review and activate them.

### Official Cities and Towns

- Official Cities and Towns live in `atlas_official_settlements`, separately
  from personal Atlas data and the mutable `GUILD` payload.
- Every client receives them automatically. Category filters may hide them,
  but clearing, replacing, importing, sharing, and deleting cannot remove them.
- Only Rangers with `trailmarks.manage` may create or revise them. There is no
  browser or database operation for retiring or deleting an official settlement.
- The migration seeds the sixteen original printed settlements and additively
  promotes any City or Town markers found in the current legacy `GUILD` payload.
- A Marshal can promote a local City or Town by selecting it in Edit Atlas and
  saving it. From then on, every Atlas receives the official revision.

The `GUILD` code remains compatible for maintained entries that are not
Trailmarks, Cities, or Towns during the transition. Publishing it no longer
controls any official location.

### Permissions

The protected permission is `trailmarks.manage`. It is granted to active Ranger
Commander, Ranger Captain, and Ranger Marshal accounts. Ordinary Rangers can
always read official locations but cannot create or edit Cities, Towns, or
Trailmarks, and cannot retire, recover, or calibrate Trailmarks.

Authorization is checked again inside every protected database function. Hiding
buttons in the browser is not the security boundary.

### Discord Identity

Discord OAuth becomes the browser identity. Wayfinder remains responsible for
syncing current Ranger membership and roles into `atlas_ranger_directory`.
Signing in alone does not grant Ranger privileges; the Discord identity must
also have an active directory record.

The existing one-time Discord device-link flow remains available during the
staged rollout. An authenticated Ranger can attach an existing device link to
their OAuth identity without reinstalling the mod.

### Map Calibration

The direct illustrated calibration maps raw outdoor Skyrim coordinates onto the
illustrated artwork. Marshals record pairs consisting of a live Skyrim position
and the exact matching point they click on the illustrated map. The calculated
projection is versioned and can be improved later with additional survey points.

Each official Trailmark stores one exact raw Skyrim access position. Its map
icon is projected from that same position through the active calibration; it
does not have an independently draggable illustrated location. A Marshal stands
at the physical cache, selects it in Edit Atlas, and chooses **Set Current Skyrim
Position**. The same coordinate then controls the 20 metre visit rule and the
illustrated icon.

Legacy visual coordinates remain only as a fallback for recovered Trailmarks
that have not yet been bound to Skyrim. Once bound, changing the calibration
automatically reprojects their browser and in-game overlay positions without
rewriting their physical access coordinates.

## Staged Rollout

1. Back up `guild_atlases`, `atlas_entry_archive`,
   `atlas_discord_device_links`, and the current Trailmark/visit tables.
2. Apply these migrations in order:
   - `supabase/migrations/202608210001_add_authoritative_trailmarks_and_ranger_auth.sql`
   - `supabase/migrations/202608250001_add_direct_illustrated_world_calibration.sql`
   - `supabase/migrations/202608270001_add_authoritative_settlements.sql`
3. Configure the Discord provider in Supabase Authentication.
4. Add the production and local Atlas URLs to the Supabase redirect allow list.
5. Add the Supabase callback URL to the Discord application:
   `https://qmuuqnfpbfncwacrrmri.supabase.co/auth/v1/callback`.
6. Update Wayfinder to synchronize active Ranger membership and roles.
7. Open the hidden Guild administration panel, review recovered Trailmark
   candidates, and activate only the correct records.
8. Review the seeded official Cities and Towns. In the Marshal administration
   panel, use **Publish Local Cities & Towns** once to reconcile legitimate
   settlements that predate the authoritative layer. Optional Skyrim reference
   markers are excluded. Newly created Cities and Towns publish automatically
   when a verified Marshal saves them.
9. Test OAuth, authorization, recovery, refresh, settlement promotion, and
   calibration locally.
10. Deploy the browser client only after the acceptance checks below pass.

Do not publish or republish the Guild Atlas as a recovery step after this
migration. Use the recovery and revision tools instead.

## Wayfinder Sync Contract

Wayfinder calls this service-role-only RPC whenever a Ranger joins, leaves, or
changes relevant roles:

```text
set_atlas_ranger_access(
  discord_user_id_input,
  display_name_input,
  active_input,
  permissions_input,
  roles_input,
  discord_profile_input
)
```

For `display_name_input`, Wayfinder should send the member's current Ranger-server
nickname (`GuildMember.displayName`). If no server nickname is set, fall back to
their Discord global display name and then username. The Atlas uses this verified
name for `Ranger name` and locks the field while the Discord session is active.

Expected policy:

- active Commander, Captain, or Marshal: include `trailmarks.manage`;
- other active Rangers: an empty permissions array;
- former or removed Rangers: `active_input = false`;
- never expose the Supabase service-role key to Discord messages, the website,
  the mod, or a local configuration file.

Because the browser re-checks the directory, removing a protected Discord role
revokes future protected actions without requiring the user to relink.

## Recovery Flow

1. Sign in with a Marshal-capable Discord account or use an already authorized
   legacy device during the transition.
2. Open the hidden administration panel through the Atlas logo.
3. Under **Recover Official Trailmarks**, load candidates.
4. Compare candidate title, notes, author, source revision, and coordinates.
5. Select only legitimate missing Trailmarks and activate them.
6. Use the revision list and restore RPC if an active Trailmark is later edited
   or retired incorrectly.

Activation is atomic: either all selected records are restored or none are.

## Calibration Flow

### Bind a Trailmark to Skyrim

1. Run Skyrim outdoors with the Ranger Atlas link active.
2. Stand at the exact physical cache location.
3. Open Edit Atlas and select the official Trailmark.
4. Choose **Set Current Skyrim Position**.
5. Confirm the change and verify the new revision.

Do not use a city centre or artwork landmark as a substitute for the cache's
actual in-game position.

### Publish the Illustrated Calibration

1. Open the hidden administration panel and the guided calibration recorder.
2. Stand outdoors at an identifiable Skyrim location.
3. Choose **Pick Exact Illustrated Point**, click the same location on the map,
   and record the coordinate pair.
4. Repeat across the northern, southern, eastern, western, and central regions.
5. Preview the calculated fit. Remove obvious mistaken points and inspect the
   RMS error, worst stop, and map spread.
6. Prepare and publish the calibration with a short reason.
7. Verify several geographically distant locations, then add more points and
   publish a later version if a region still needs improvement.

Publishing creates a new immutable active version. It reprojects live players
and bound Trailmark icons, but does not rewrite stored Trailmark game positions.

## Acceptance Checks

- An ordinary Ranger sees every active official Trailmark.
- An ordinary Ranger sees every official City and Town and may hide them only
  with category filters.
- An ordinary Ranger cannot create, recategorize, edit, move, retire, recover,
  restore, or calibrate an official Trailmark.
- An ordinary Ranger cannot create, edit, move, or delete an official City or Town.
- A Marshal can perform each protected operation.
- Removing the Marshal role revokes protected access without relinking.
- Official Trailmarks survive Scrape Clean, Replace Mine, code imports, and a
  browser refresh.
- Official Trailmarks are excluded from personal share codes and Guild Atlas
  publishes.
- Official Cities and Towns are excluded from personal share codes and Guild
  Atlas publishes, and survive cleanup, replacement, and imports.
- A second open browser receives an official Trailmark change within one minute.
- Archived Trailmarks appear only as recovery candidates until activated.
- Restoring a revision returns both its content and exact game position.
- A Trailmark bound at its in-game cache can be visited within 20 metres after
  browser refresh and after entering/leaving an interior.
- Recalibrating the illustrated map changes visual projection without changing
  the 20 metre proximity check.
- The native overlay receives the same projected Trailmark positions as the
  browser illustrated map.
- OAuth login, logout, role refresh, and device attachment all work without
  exposing a secret key.

## Rollback

Before the browser client is deployed, rollback is simply leaving production on
the existing client. The new migration does not replace or drop its tables.

After a staged client deployment, revert the client to the previous build if
needed. Keep the new authoritative and revision tables intact so no recovered or
edited Trailmark history is lost. Do not drop the new tables as an operational
rollback.
