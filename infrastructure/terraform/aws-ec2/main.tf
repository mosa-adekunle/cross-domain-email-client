# ============================================================
# CROSS DOMAIN EMAIL CLIENT - AWS EC2 INFRASTRUCTURE
# ============================================================
# Region: us-east-2 (Ohio)
# Instance: t4g.small (ARM64, 2 vCPU, 2 GiB RAM)
# Storage: 16 GiB encrypted gp3 EBS
# Networking: Default VPC, public subnet, Elastic IP
# Authentication: SSH public key
# Managed by: Terraform
# ============================================================


# ------------------------------------------------------------
# 1. EXISTING AWS NETWORK
# ------------------------------------------------------------

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}


# ------------------------------------------------------------
# 2. UBUNTU 24.04 ARM64 AMI
# ------------------------------------------------------------

data "aws_ami" "ubuntu_arm64" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}


# ------------------------------------------------------------
# 3. SSH KEY PAIR
# ------------------------------------------------------------

resource "aws_key_pair" "admin" {
  key_name_prefix = "${var.project_name}-"
  public_key      = trimspace(file("${path.module}/admin-ssh.pub"))

  tags = {
    Name = "${var.project_name}-admin-key"
  }
}


# ------------------------------------------------------------
# 4. SECURITY GROUP
# ------------------------------------------------------------

resource "aws_security_group" "app" {
  name_prefix = "${var.project_name}-"
  description = "Cross Domain Email application firewall"
  vpc_id      = data.aws_vpc.default.id

  tags = {
    Name = "${var.project_name}-sg"
  }
}


# Allow SSH using public-key authentication.

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.app.id
  description       = "SSH public key access"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}


# Allow outbound connectivity for updates, Docker,
# Cloudflare R2, and external APIs.

resource "aws_vpc_security_group_egress_rule" "outbound" {
  security_group_id = aws_security_group.app.id
  description       = "Allow outbound IPv4 connections"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}


# HTTP and HTTPS will be configured when the application
# is ready for deployment. PostgreSQL will remain private.


# ------------------------------------------------------------
# 5. EC2 INSTANCE
# ------------------------------------------------------------

resource "aws_instance" "app" {
  ami                         = data.aws_ami.ubuntu_arm64.id
  instance_type               = var.instance_type
  subnet_id                   = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = false
  key_name                    = aws_key_pair.admin.key_name

  # Prevent additional unlimited-mode CPU credit charges.
  credit_specification {
    cpu_credits = "standard"
  }

  # Require IMDSv2.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  # Encrypted and expandable root storage.
  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gib
    encrypted             = true
    delete_on_termination = true
  }

  # Initial server security configuration.
  # Application containers will be configured separately.
  user_data = <<-EOF
    #cloud-config
    ssh_pwauth: false
    disable_root: true

    write_files:
      - path: /etc/ssh/sshd_config.d/00-hardening.conf
        permissions: '0644'
        content: |
          PermitRootLogin no
          PasswordAuthentication no
          KbdInteractiveAuthentication no
          PubkeyAuthentication yes
    EOF

  # Protect the instance from accidental Terraform deletion.
  # Remove this protection only during an approved migration
  # or infrastructure decommission.
  lifecycle {
    prevent_destroy = true

    # Avoid replacing the instance just because Canonical
    # publishes a newer Ubuntu AMI.
    ignore_changes = [ami, associate_public_ip_address]
  }

  tags = {
    Name = "${var.project_name}-app"
    Role = "email-application"
  }
}


# ------------------------------------------------------------
# 6. ELASTIC IP
# ------------------------------------------------------------

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = {
    Name = "${var.project_name}-elastic-ip"
  }
}

# ------------------------------------------------------------
# END
# ------------------------------------------------------------
