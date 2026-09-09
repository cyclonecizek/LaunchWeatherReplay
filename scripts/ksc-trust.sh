#!/usr/bin/env bash
set -euo pipefail

# KSC's leaf certificate names this Sectigo-hosted Entrust intermediate in its AIA.
# Supply the missing intermediate only after validating it against the runner's
# existing trusted roots. Never disable peer/hostname verification or add an
# unverified root certificate.
task_cert_dir="${RUNNER_TEMP:?GitHub runner temporary directory is required}/ksc-certificates"
mkdir -p "$task_cert_dir"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --max-time 30 --retry 2 \
  'https://crt.sectigo.com/EntrustDVTLSIssuingRSACA2.crt' \
  --output "$task_cert_dir/issuer.der"
openssl x509 -inform DER -in "$task_cert_dir/issuer.der" -out "$task_cert_dir/issuer.pem"
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt "$task_cert_dir/issuer.pem"
printf 'NODE_EXTRA_CA_CERTS=%s\n' "$task_cert_dir/issuer.pem" >> "${GITHUB_ENV:?GitHub environment file is required}"
