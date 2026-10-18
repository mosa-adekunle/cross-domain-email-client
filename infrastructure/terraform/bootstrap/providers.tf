provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "cross-domain-email-client"
      ManagedBy = "terraform"
      Purpose   = "terraform-state"
    }
  }
}
