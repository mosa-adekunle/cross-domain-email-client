output "state_bucket_name" {
  description = "Private Terraform state bucket"
  value       = aws_s3_bucket.state.id
}

output "state_bucket_region" {
  description = "Terraform state region"
  value       = var.aws_region
}
