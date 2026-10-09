// Stub used by root npm scripts that are not implemented yet.
// It must fail loudly: a stub that exits 0 would let CI pass while checking nothing.
// Usage: node scripts/not-implemented.mjs <script-name> [<owning ticket or epic> ...]
const [name = '(unknown)', ...owners] = process.argv.slice(2);
const owner = owners.length > 0 ? owners.join(', ') : 'a later ticket';
console.error(`[slydr] "npm run ${name}" is not implemented yet (owned by: ${owner}).`);
console.error('[slydr] This stub fails on purpose so an unimplemented step cannot pass silently.');
process.exit(1);
