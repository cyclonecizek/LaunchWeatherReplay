#!/usr/bin/env bash
set -euo pipefail

# KSC's leaf certificate names this Sectigo-hosted Entrust intermediate in its AIA.
# Supply the missing intermediate only after validating it against the runner's
# existing trusted roots. The public AIA certificate is transported over HTTP;
# its signature and chain must verify before it can be trusted. Never disable peer/hostname verification or add an
# unverified root certificate.
task_cert_dir="${KSC_CERT_DIR:-${RUNNER_TEMP:?Set KSC_CERT_DIR or RUNNER_TEMP}/ksc-certificates}"
mkdir -p "$task_cert_dir"
curl --fail --silent --show-error --location --proto '=http,https' --proto-redir '=http,https' \
  --max-time 30 --retry 2 \
  'http://crt.sectigo.com/EntrustDVTLSIssuingRSACA2.crt' \
  --output "$task_cert_dir/issuer.der"
openssl x509 -inform DER -in "$task_cert_dir/issuer.der" -out "$task_cert_dir/issuer.pem"
openssl x509 -in "$task_cert_dir/issuer.pem" -noout -subject -issuer
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt "$task_cert_dir/issuer.pem"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'NODE_EXTRA_CA_CERTS=%s\n' "$task_cert_dir/issuer.pem" >> "$GITHUB_ENV"
fi
