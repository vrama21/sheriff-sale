## MODIFIED Requirements

### Requirement: CI applies infrastructure on main only

The CI workflow SHALL run `tofu init` and `tofu apply -auto-approve` in `infra/` only on pushes to `main`, in the `prod` GitHub environment, after the `migrate` job succeeds. It SHALL use the Lambda bundle produced by the `build` job of the same run. On other branches, CI SHALL run only offline OpenTofu commands that use no AWS credentials and no backend: `tofu fmt -check -recursive`, `tofu init -backend=false`, and `tofu validate`, in an `infra-check` job outside any GitHub environment. `migrate` SHALL depend on `infra-check`.

#### Scenario: Push to main

- **WHEN** a commit lands on `main` and `build`, `infra-check`, and `migrate` succeed
- **THEN** the infrastructure job applies `infra/` using the `build` job's bundle, the `prod` environment's AWS role, and its `DATABASE_URL` secret

#### Scenario: Push to a feature branch

- **WHEN** a commit is pushed to a non-main branch
- **THEN** `infra-check` runs `fmt`, `init -backend=false`, and `validate`. No `plan` or `apply` runs, and no AWS credentials are used.

#### Scenario: Unformatted infra

- **WHEN** a branch commits a `.tf` file that `tofu fmt` would change
- **THEN** `infra-check` fails, and on `main` no deploy job runs

### Requirement: Single prod GitHub environment

CI deploy jobs (`migrate`, `deploy-backend`, `deploy-frontend`) SHALL use the GitHub environment `prod`. It SHALL hold the secrets `DATABASE_URL` and `VERCEL_TOKEN`, the variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (identifiers, not credentials), and optionally the variable `ALARM_EMAIL`. It SHALL NOT hold AWS credentials. The `dev` GitHub environment SHALL be deleted once `prod` is in use. The `prod` environment's deployment branch policy is the boundary that guards the prod secrets and the AWS role, because a job's `if:` condition is controlled by whoever pushes the workflow. The policy SHALL allow `main` only.

#### Scenario: Deploy jobs use prod

- **WHEN** the workflow runs on `main`
- **THEN** every deploy job runs in the `prod` environment

#### Scenario: No dev environment remains

- **WHEN** the repository's GitHub environments are listed after cutover
- **THEN** `dev` is not among them

#### Scenario: Other branches cannot enter prod

- **WHEN** a workflow on a branch other than `main` declares `environment: prod`
- **THEN** GitHub refuses to run the job in that environment

### Requirement: CI authenticates to AWS with OIDC

CI SHALL get AWS credentials only by assuming the IAM role `sheriff-sale-github-actions` through GitHub's OIDC provider. The role SHALL trust only tokens with audience `sts.amazonaws.com` and subject `repo:vrama21/sheriff-sale:environment:prod`. Its permissions SHALL be limited to this project's resource ARNs:

- the state bucket and its objects
- the archive bucket's configuration (no object access)
- the scraper function
- the scraper and CI roles
- the OIDC provider
- the DLQ
- the schedule rule
- the scraper log group
- the alarm SNS topic and its subscriptions
- the scraper's CloudWatch alarms

The exceptions are read-only describe actions that have no resource-level permissions. No long-lived AWS access keys SHALL be stored in GitHub, and the `cicd-pipeline-deployer` IAM user SHALL be deleted. A statement for a new resource type SHALL be applied from a developer machine before CI first applies that resource.

#### Scenario: Deploy job assumes the role

- **WHEN** `deploy-backend` runs on `main`
- **THEN** its AWS identity is `assumed-role/sheriff-sale-github-actions/…`, and `tofu apply` completes without access errors

#### Scenario: Other contexts cannot assume the role

- **WHEN** a job outside the repo's `prod` environment (e.g. a feature-branch job with no environment) requests credentials for the role
- **THEN** `AssumeRoleWithWebIdentity` is denied

#### Scenario: No AWS keys remain

- **WHEN** the repository's secrets (repository and environment level) and the account's IAM users are listed after handover
- **THEN** no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secrets exist and `cicd-pipeline-deployer` does not exist

#### Scenario: Alarm resources are within the policy

- **WHEN** CI applies a change to the alarm topic, its subscription, or the scraper alarms
- **THEN** the apply completes without access errors
