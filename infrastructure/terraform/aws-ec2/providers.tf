provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "cross-domain-email-client"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
