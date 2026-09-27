// Hostinger's Next.js preset may start Next directly instead of npm start.
// Run the same locked, checksummed migrations during deployment as well.
// Offline builds without database configuration remain supported.
if (['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'].some(name => process.env[name])) {
  await import('./migrate.mjs');
} else {
  console.log('Offline build: database migrations will run on npm start.');
}
