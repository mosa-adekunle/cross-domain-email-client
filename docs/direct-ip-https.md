# Direct HTTPS on the EC2 Elastic IP

Open **https://52.14.33.209** without a domain, Cloudflare Tunnel or public HTTP/80. HTTPS terminates at the existing Nginx web container; the database remains private. Administrator authentication and CSRF protection remain enabled.

## Infrastructure

The Terraform-managed security group gains exactly one IPv4 ingress rule, `aws_vpc_security_group_ingress_rule.https`, allowing TCP/443 from `0.0.0.0/0`. All other security-group resources and EC2 replacement safeguards must remain unchanged.

On the **Terraform execution host** (`ssh receiptboss-dev`), make sure its **existing** local `main.tf` has the same HTTPS resource committed to GitHub. Do not overwrite local Terraform state, run bootstrap again, or blindly replace existing Terraform files.

```bash
cd ~/cross-domain-email-client/infrastructure/terraform/aws-ec2
export AWS_PROFILE=cross-domain-email-terraform
cp main.tf "/tmp/cdec-main.before-https.$(date +%Y%m%d-%H%M%S).tf"

python3 - <<'PY'
from pathlib import Path
path=Path("main.tf")
content=path.read_text()
block = '''resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  description       = "Cross Domain Email Client public HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}'''
if 'resource "aws_vpc_security_group_ingress_rule" "https"' not in content:
    if 'resource "aws_vpc_security_group_ingress_rule" "ssh"' not in content:
        raise SystemExit("STOP: Existing security group source not recognized.")
    path.write_text(content.rstrip()+"\n\n"+block+"\n")
print("HTTPS ingress resource configured.")
PY

terraform fmt main.tf
terraform validate
terraform plan
```

**Only proceed if the plan shows exactly one HTTPS ingress rule addition with no changes to EC2, EIP, or existing security-group rules.** Then run `terraform apply` and verify its output. Stop if a different plan is proposed.

## Install trusted IP certificate and HTTPS web container

Let's Encrypt now issues publicly trusted IPv4 certificates for around **160 hours** (about six days). This setup uses the TLS-ALPN-01 challenge on **port 443 only** via `goacme/lego:v5.0.1`. Issuance and renewal briefly stop the *web* container so the ACME client can bind that port; the API and PostgreSQL keep running.

Run these commands on the **application EC2 server** (`ssh cross-domain-email`):

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
git rev-parse --short HEAD
sudo docker compose config --quiet
sudo docker compose build web

# Replace the contact email with your own reachable address.
sudo ACME_EMAIL=you@example.com bash scripts/renew-ip-https.sh

# Only after certificate issuance succeeded:
sudo docker compose up -d --no-deps --force-recreate api web
bash scripts/verify-ip-https.sh
```

The certificate/private key live in `runtime/ip-https/`, excluded from Git and the Docker build context. **Never commit or upload the contents of this directory.** The API environment uses `APP_URL=https://52.14.33.209` and secure-only session cookies. The old tunnel remains available for *non-login maintenance* on `127.0.0.1:8080`.

### Automatic renewal

Install the bundled systemd timer after the first successful certificate and HTTPS verification:

```bash
cd ~/cross-domain-email-client
sudo install -m 0644 systemd/cdec-ip-https-renew.service /etc/systemd/system/
sudo install -m 0644 systemd/cdec-ip-https-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cdec-ip-https-renew.timer
systemctl list-timers cdec-ip-https-renew.timer
sudo systemctl start cdec-ip-https-renew.service
sudo journalctl -u cdec-ip-https-renew.service --no-pager -n 30
```

The script checks certificate expiry and does nothing while more than three days remain, so normal checks do **not** interrupt the web container. The timer checks twice daily. Monitor timer failures and the expiry date, because public IP certificates expire quickly. When renewal is needed, the web server may be unavailable for a short period.

## Verification

```bash
# On EC2, validates the trusted TLS chain using the loopback listener
# (avoids unreliable AWS Elastic IP hairpin traffic):
cd ~/cross-domain-email-client
bash scripts/verify-ip-https.sh

# Confirm certificate expiration and IP subject alternative name:
sudo openssl x509 -in runtime/ip-https/tls/fullchain.pem -noout -dates -ext subjectAltName
```

From **another device or network**, browse directly to **https://52.14.33.209**. It must load without a TLS warning and prompt for administrator login. The AWS security group publishes only 443 for the web application; ports 80, 8080 and 5432 are not publicly exposed.

Do not use `curl -k` to bypass TLS checks. If certificate issuance or validation fails, do not disable the browser's certificate verification. Restore/retain SSH tunnel access and diagnose port 443 or the ACME challenge instead.

Security note: Publicly exposing an administrative inbox increases scanning and password attacks. Continue using strong credentials, rate limits, timely patches, and secure backups. Changes to application code still require GitHub deployment; certificates and Terraform state remain server-local.
