# Source Sync Notes

- Prefer ATS APIs first.
- Use the Greenhouse Job Board API when a board token is available.
- Use Lever's public postings feed when a company slug is available.
- Org-specific career pages can be added later as approved sources.
- Wide search should use API providers only and always route to pending review.
- Never scrape LinkedIn.
- Never scrape Indeed directly.
- Unknown sources are never auto-published.
- All synced jobs should enter pending review before publication unless the source is explicitly marked trusted in the future.
- Only approved jobs should appear publicly on the board.
