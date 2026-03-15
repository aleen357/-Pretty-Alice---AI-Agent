output "service_url" {
  description = "The URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.default.uri
}

output "repository_url" {
  description = "The URL of the Artifact Registry repository"
  value       = google_artifact_registry_repository.repo.name
}
