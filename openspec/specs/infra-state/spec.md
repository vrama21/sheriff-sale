# infra-state Specification

## Purpose

Where the OpenTofu state for `infra/` lives, how it is locked and protected from loss, and how its state bucket was bootstrapped from the same config.

## Requirements

### Requirement: Remote state in a project-owned S3 bucket

OpenTofu state for the `infra/` root config SHALL be stored by the `s3` backend in a bucket in account 590184139982, region us-east-2. The bucket's name SHALL include the account ID. The bucket SHALL be declared as an `aws_s3_bucket` resource in the same root config. The bucket name SHALL be defined once and referenced from both the backend block and the resource.

#### Scenario: Initializing a fresh checkout

- **WHEN** a developer or CI runs `tofu init` in `infra/` after bootstrap is complete
- **THEN** OpenTofu configures the `s3` backend pointing at the state bucket and loads existing state without prompting for a migration

#### Scenario: State bucket is managed by the config it serves

- **WHEN** `tofu plan` runs after bootstrap
- **THEN** the state bucket and its settings appear as managed resources with no pending changes

### Requirement: State bucket is protected against loss

The state bucket SHALL have versioning enabled, all four S3 Block Public Access settings enabled, and default server-side encryption. Its resource SHALL set `lifecycle { prevent_destroy = true }`.

#### Scenario: Accidental destroy

- **WHEN** someone runs `tofu destroy` or makes a change that would replace the state bucket
- **THEN** OpenTofu refuses the plan with a `prevent_destroy` error and no state bucket deletion is attempted

#### Scenario: Recovering an overwritten state file

- **WHEN** the state object is overwritten with bad content
- **THEN** a previous version of the state object is still available through S3 object versioning

### Requirement: State locking without DynamoDB

The backend SHALL use S3-native locking (`use_lockfile = true`). It SHALL NOT use a DynamoDB lock table.

#### Scenario: Concurrent applies

- **WHEN** two `tofu apply` runs start against the same state at the same time
- **THEN** the second run fails to acquire the lock and makes no changes

### Requirement: One-time bootstrap from local state

The repository SHALL document a one-time bootstrap. First, create the state bucket using local state. Then migrate that state into the bucket with `tofu init -migrate-state`. Finally, delete the local state files. Local state files SHALL be gitignored.

#### Scenario: Bootstrap completes

- **WHEN** the documented bootstrap steps are run once with the `sheriff-sale` AWS profile
- **THEN** the state object exists in the state bucket, no `terraform.tfstate*` files remain in `infra/`, and a subsequent `tofu plan` reports no changes to the state bucket

### Requirement: Pinned OpenTofu version

The OpenTofu version SHALL be pinned in the repository's `mise.toml`. The root config SHALL declare a minimum `required_version` that supports `use_lockfile` and variables or locals in the backend block (OpenTofu ≥ 1.10).

#### Scenario: Running with an older OpenTofu

- **WHEN** `tofu init` is run with an OpenTofu version older than the declared `required_version`
- **THEN** initialization fails with a version constraint error
