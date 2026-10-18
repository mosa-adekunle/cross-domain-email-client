variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "us-east-2"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gib" {
  description = "Root EBS volume size in GiB"
  type        = number
  default     = 16

  validation {
    condition     = var.root_volume_gib >= 16
    error_message = "Root volume must be at least 16 GiB."
  }
}

variable "project_name" {
  description = "Resource naming prefix"
  type        = string
  default     = "cross-domain-email"
}
