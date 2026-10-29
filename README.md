# caudra-models

This repository is the source of Caudra's model list. It holds the curated provider files and a
reviewed import of models.dev. `make build` turns them into `dist/v1/models.json`, which Caudra
reads from `https://models.caudra.ai/v1/models.json`.

## Set up

1. Install the `caudra-models` tool into `.tools/bin`:

	```sh
	make tool
	```

	`make tool` builds the tool from the Caudra commit pinned in `caudra.toml`. To build from a
	local Caudra checkout instead, run `make tool CAUDRA_SRC=<path to the checkout>`.

2. Optional. Install a pre-commit hook that runs `make check`:

	```sh
	make hooks
	```

Run `make help` to list every target.

## Change a model

1. Edit `providers/<slug>.json`. The `$schema` line gives editors completion and validation.
2. Run `make build` to regenerate `dist/` and `schema/`.
3. Run `make check`.
4. Commit the provider file and the regenerated files, and open a pull request.

`make check` fails when `dist/` or `schema/` does not match the sources, so a pull request that
skips step 2 fails CI.

## Refresh the models.dev import

1. Run `make import`. It downloads `https://models.dev/api.json` into `.tools/`, rewrites
	`import/models-dev.json`, and runs `make build`.
2. Review `git diff import/` before you commit. Every row in the import reaches Caudra's model
	catalog.

## Format rules for v1

Every Caudra release that reads v1 must keep working with every later v1 file.

- Changes are additive only. A new field is optional and has a default that keeps the old
	behaviour.
- Renaming a field, changing its type, or changing what a value means needs format v2.
- Clients ignore fields they do not know.
- If a provider or a model needs new Caudra code, list a token in its `requires`. A Caudra build
	that does not know the token hides the entry, and an explicit request for it fails with "needs
	a newer Caudra". Ship the code that handles the token in Caudra before you use the token here.

## Reference

### `updated_at`

`updated_at` is the time the content last changed. `make build` hashes the payload into
`content_sha256`. If the hash equals the one in the existing `dist/v1/models.json`, the build keeps
the old `updated_at`. Otherwise it stamps the current UTC time, or `NOW=<RFC 3339 time>` when you
pass it. A build with no content change leaves `git status` clean.

### Signing

The `publish` workflow runs on every push to `main`. It checks the repository, signs
`dist/v1/models.json` with the `CAUDRA_MODELS_SIGNING_KEY` secret, and verifies the signature with
the public key in the `CAUDRA_MODELS_PUBLIC_KEY` repository variable. It uploads `models.json`,
`models.json.sig`, and `schema.json` as the `models-v1` artifact.

The private key never enters this repository. `.gitignore` excludes `*.pkcs8` and `*.sig`.
`caudra-models keygen <path>` creates a key pair and prints the public key and its key id.

To rotate the key:

1. Run `caudra-models keygen` to create the new key pair.
2. Add the new public key to Caudra's trusted keys next to the old one, and ship a Caudra release.
3. Wait until users run releases that trust the new key. Releases that trust only the old key
	reject a file signed with the new key.
4. Replace the secret and the repository variable with the new key pair.
5. Remove the old public key from Caudra's trusted keys in a later release.

### Make targets

| Target | What it does |
| --- | --- |
| `make tool` | Installs `caudra-models` into `.tools/bin` |
| `make check` | Validates the data and fails if `dist/` or `schema/` is stale |
| `make build` | Writes `dist/` and `schema/`. `NOW=` sets the time for a changed snapshot |
| `make import` | Downloads models.dev, rewrites `import/models-dev.json`, and builds |
| `make audit` | Placeholder. The audit moves here in a later change |
| `make hooks` | Installs a pre-commit hook that runs `make check` |

### Layout

| Path | Contents |
| --- | --- |
| `caudra.toml` | The Caudra git URL, commit, toolchain, and features that `make tool` builds from |
| `providers/index.json` | The ordered list of built-in provider slugs |
| `providers/<slug>.json` | One provider. `models_from` copies another provider's models, generations, price periods, and availability |
| `decision-models.json` | The models behind decision endpoints |
| `import/models-dev.json` | The reviewed models.dev import |
| `schema/*.v1.json` | Generated JSON schemas for the authoring files and the snapshot |
| `dist/v1/models.json` | The built snapshot |
| `dist/v1/schema.json` | The snapshot's JSON schema |
| `.github/workflows/` | `check` runs `make check` on pull requests and on `main`. `publish` signs and uploads |

## License

This repository is licensed under the Apache License 2.0. See `LICENSE`.

The models.dev data in `import/models-dev.json` and in the `catalog` section of
`dist/v1/models.json` keeps its upstream MIT license. See `NOTICE`.
