name: Ingest private companies

on:
  workflow_dispatch:
    inputs:
      dryRun:
        description: "Dry run (no writes to your API)"
        required: false
        default: "true"
      maxCompanies:
        description: "Max companies to process (0 = all)"
        required: false
        default: "0"
      csvPath:
        description: "Path to CSV in THIS private repo"
        required: false
        default: "data/companies.csv"
      publicRepo:
        description: "Public backend repo (owner/name)"
        required: true
        default: "GGGP-Test/galactly-monorepo-v1"
      backendDir:
        description: "Backend directory inside the public repo"
        required: false
        default: "Backend"

jobs:
  ingest:
    runs-on: ubuntu-latest

    steps:
      - name: Check out PRIVATE repo (this one)
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Verify CSV exists
        run: |
          set -e
          test -f '${{ inputs.csvPath }}' || (echo "CSV not found: ${{ inputs.csvPath }}" && exit 1)
          echo "Found CSV:" && ls -l '${{ inputs.csvPath }}'

      - name: Check out PUBLIC backend repo (read-only)
        uses: actions/checkout@v4
        with:
          repository: ${{ inputs.publicRepo }}
          path: app
          fetch-depth: 1

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install backend deps (no dev/optional)
        working-directory: app/${{ inputs.backendDir }}
        run: |
          npm ci --omit=dev --omit=optional

      - name: Copy CSV into backend workspace (untracked)
        run: |
          mkdir -p 'app/${{ inputs.backendDir }}/data'
          cp '${{ inputs.csvPath }}' 'app/${{ inputs.backendDir }}/data/companies.csv'
          echo "Workspace data dir:" && ls -l 'app/${{ inputs.backendDir }}/data'

      - name: Run batch importer (TS with tsx)
        working-directory: app/${{ inputs.backendDir }}
        env:
          API_BASE: ${{ secrets.API_BASE }}              # e.g. https://<your-northflank>.../api
          ADMIN_KEY_NAME: ${{ secrets.ADMIN_KEY_NAME }}  # usually: x-admin-key
          ADMIN_KEY_VALUE: ${{ secrets.ADMIN_KEY_VALUE }}# the secret value
          DRY_RUN: ${{ inputs.dryRun }}
          MAX_COMPANIES: ${{ inputs.maxCompanies }}
        run: |
          set -euo pipefail
          echo "Importer starting..."
          echo "API_BASE=${API_BASE}"
          echo "adminHeader=${ADMIN_KEY_NAME:-x-admin-key}"
          echo "dryRun=${DRY_RUN} maxCompanies=${MAX_COMPANIES}"

          # IMPORTANT: we are already in app/<Backend>, so pass a RELATIVE path here
          npx -y tsx ./scripts/find-buyers-batch.ts \
            --csv "./data/companies.csv" \
            --dryRun "${DRY_RUN}" \
            --limit "${MAX_COMPANIES}" \
            --adminHeader "${ADMIN_KEY_NAME:-x-admin-key}" \
            --adminKey "${ADMIN_KEY_VALUE}"