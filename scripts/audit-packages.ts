import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const publicPackages = ['cli', 'mcp', 'sdk', 'n8n'];

for (const directory of publicPackages) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const [name, value] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (value.startsWith('workspace:')) throw new Error(`${manifest.name} contains workspace dependency ${name}.`);
  }

  const destination = await mkdtemp(join(tmpdir(), 'dlvr-pack-audit-'));
  const packed = Bun.spawnSync(
    ['npm', 'pack', '--ignore-scripts', '--pack-destination', destination, '--json'],
    { cwd: directory },
  );
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString() || packed.stdout.toString());
  const archive = (await readdir(destination)).find((file) => file.endsWith('.tgz'));
  if (!archive) throw new Error(`${manifest.name} did not produce a tarball.`);

  const unpacked = Bun.spawnSync(['tar', '-xzf', join(destination, archive), '-C', destination]);
  if (unpacked.exitCode !== 0) throw new Error(unpacked.stderr.toString());
  const packageRoot = join(destination, 'package');
  const files = await readdir(packageRoot, { recursive: true });
  for (const relative of files) {
    const file = join(packageRoot, relative);
    if (!(await stat(file)).isFile()) continue;
    if (directory === 'n8n' && (relative.endsWith('.d.ts') || relative.endsWith('.map'))) {
      throw new Error(`${manifest.name} packed non-runtime build output ${relative}.`);
    }
    const contents = await readFile(file).catch(() => null);
    if (!contents) continue;
    const text = contents.toString('utf8');
    if (text.includes('from "@dlvr/shared"') || text.includes("from '@dlvr/shared'")) {
      throw new Error(`${manifest.name} packed a runtime @dlvr/shared reference in ${relative}.`);
    }
  }
}

console.log(`Audited ${publicPackages.length} public package tarballs.`);
