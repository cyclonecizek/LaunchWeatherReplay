import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// A real completed ZIP for testing the same host and download path, without a job.
execFileSync('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
 z.writestr('README.txt', 'LAUNCH WEATHER REPLAY DOWNLOAD TEST\\r\\n\\r\\nThis is a small test from the public replay server. No weather data is included.\\r\\nIf this extracts successfully, try a short weather scenario next.\\r\\n')
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
`, fileURLToPath(new URL('../server/public/network-test.zip', import.meta.url))]);
