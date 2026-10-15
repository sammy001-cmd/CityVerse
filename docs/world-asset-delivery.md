# World asset delivery

CityVerse world datasets are immutable, versioned releases. `world/release.json`
is the Git-tracked pin used by the client build and by `assets:sync`; generated
tile files remain outside normal Git history.

## Team workflow

Fresh clone:

```sh
git clone <repository>
cd CityVerse
npm install
npm run assets:sync
npm run dev -w @cityverse/client
```

Existing teammate:

```sh
git pull
npm run assets:sync
```

Set `WORLD_ASSET_URL` to the public HTTP(S) storage root before syncing. It
must serve `releases/<release-id>/...`; for example, if the release manifest
is served at `https://assets.example.com/cityverse/releases/world-0001/release.json`,
set the base to `https://assets.example.com/cityverse`. The URL must not
contain credentials, a query, or a fragment.

World author:

1. Generate or update the local data under `apps/client/public/data/`.
2. Create a new immutable release ID and commit the updated pin:

   ```sh
   npm run assets:create -- --release world-0002
   npm run assets:validate
   ```

3. Set the S3-compatible storage configuration in the publishing process
   environment, then publish:

   ```sh
   npm run assets:publish
   npm run assets:verify:remote
   ```

4. Deploy the client built from that committed pin. Set
   `VITE_WORLD_ASSET_URL` to the same public storage root. Production builds
   validate every pinned object and fail if any is missing or corrupt.

`assets:create` includes each declared world layer, hashes all included files,
and reports unchanged, changed, added, and removed paths versus the prior
local inventory. Release IDs are immutable; use a new ID for any content
change. `assets:publish` uploads the release to
`releases/<release-id>/...` using create-only writes and read-after-write hash
verification. It updates `current.json` only after the complete immutable
release verifies. If upload or verification fails, the active pointer is not
changed. The publish command supports `--no-activate` for staging without
changing that pointer.

Required publishing environment:

```text
WORLD_ASSET_S3_ENDPOINT=https://s3-compatible.example.com
WORLD_ASSET_BUCKET=cityverse-world
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Optional settings are `WORLD_ASSET_REGION` (or `AWS_REGION`),
`WORLD_ASSET_PREFIX`, and `WORLD_ASSET_PATH_STYLE=false`. Credentials are read
only from environment variables; do not commit them. `WORLD_ASSET_URL` is the
public read URL and may differ from the S3 endpoint. `VITE_WORLD_ASSET_URL`
must be available during the client build.

## Runtime and storage behavior

`WorldAssetResolver` is the only owner of asset URL selection. Without a
remote URL, author checkouts load `/data/...`; after sync, development loads
the selected `/data/releases/<release-id>/data/...` snapshot. With
`VITE_WORLD_ASSET_URL`, runtime URLs include the pinned release ID, so the
client cannot mix files from different releases. Building, road, map, POI,
and landmark consumers retain their lazy loading and streaming behavior.

Synced files are hash-checked before they are written and local activation is
updated only after the entire release is present. Existing correct files and
files with the same verified hash in the previous local release are reused;
missing or corrupt files are downloaded again. Sync does not delete previous
releases or unrelated files.

The client verifies remote file sizes and SHA-256 digests against the pinned
integrity index before returning world data. A failure emits a
`cityverse:world-asset-error` diagnostic and rejects that asset request; it
does not fall back to another release. Versioned release objects are
published with `public,max-age=31536000,immutable`. The mutable `current.json`
pointer is published with `no-cache,max-age=0,must-revalidate`. Client builds
use the explicit Git pin rather than resolving `current.json` at runtime.

## Local commands and checks

```sh
npm run assets:create -- --release world-0002
npm run assets:validate
npm run assets:sync
npm run assets:publish
npm run assets:verify:remote
npm run assets:test
```

`assets:validate` checks the pinned local author dataset, including the
expected 12,477 Ibadan building tiles. `assets:verify:remote` downloads and
checks every object in the pinned release. A production Vite build performs
the same remote completeness check and refuses to bundle the developer's
local generated `data/` directory.
