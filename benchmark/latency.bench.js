import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { classifyPreRoute, createPreRouter } from '../dist/index.js';

const PROMPTS = [
  'Write a TypeScript function to reverse a linked list.',
  'Calculate \\frac{7}{12} + \\sqrt{81} and find x in the quadratic equation.',
  'Translate "Where is the library?" into Spanish.',
  'Given board position with FEN rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR, what is the best move?',
  'Based on the provided passage, what was the primary cause of the treaty failure?',
  'Analyze the 10-K balance sheet and calculate the diluted EPS and operating margin.',
  'Convert 100 miles to km.',
  'Prettify this JSON string: {"key":"value"}',
  'Hey, how are you feeling today?',
  'Tell me what you think about modern abstract art in contemporary galleries.'
];

function calculatePercentiles(latenciesMicros) {
  const sorted = [...latenciesMicros].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = sorted.reduce((sum, v) => sum + v, 0) / n;
  return {
    min: sorted[0],
    p50: sorted[Math.floor(n * 0.50)],
    p90: sorted[Math.floor(n * 0.90)],
    p99: sorted[Math.floor(n * 0.99)],
    max: sorted[n - 1],
    avg
  };
}

function runBenchmark(name, description, iterations, fn) {
  // Warmup (1,000 iterations)
  for (let i = 0; i < 1000; i++) {
    fn(PROMPTS[i % PROMPTS.length]);
  }

  const latenciesMicros = new Float64Array(iterations);
  const t0 = performance.now();

  for (let i = 0; i < iterations; i++) {
    const prompt = PROMPTS[i % PROMPTS.length];
    const start = performance.now();
    fn(prompt);
    const end = performance.now();
    latenciesMicros[i] = (end - start) * 1000; // milliseconds to microseconds
  }

  const totalTimeMs = performance.now() - t0;
  const stats = calculatePercentiles(latenciesMicros);
  const opsPerSec = Math.round((iterations / totalTimeMs) * 1000);

  return { name, description, iterations, stats, opsPerSec };
}

const cpus = os.cpus();
const cpuModel = cpus[0]?.model ?? 'Unknown CPU';
const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(1);

console.log('='.repeat(72));
console.log('  krusch-pre-router Microsecond Benchmark (10,000 iterations)');
console.log('='.repeat(72));
console.log('Hardware & Runtime Environment:');
console.log(`  • Node.js:  ${process.version} (V8 ${process.versions.v8})`);
console.log(`  • Platform: ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`  • CPU:      ${cpuModel} (${cpus.length} cores)`);
console.log(`  • Memory:   ${totalMemGb} GB Total System RAM`);
console.log('='.repeat(72));

const coldBench = runBenchmark(
  'Cold Regex Heuristic (classifyPreRoute)',
  'CPU heuristic classification on unseen prompts (regex matching + scoring)',
  10000,
  (p) => {
    classifyPreRoute(p);
  }
);

const router = createPreRouter({ cache: { maxSize: 1000 } });
// Pre-populate cache with test prompts
for (const p of PROMPTS) router.classify(p);

const warmBench = runBenchmark(
  'Warm LRU Memo Table Hit (router.classify)',
  'In-memory Map lookup + defensive clone for repeated prompts/templates',
  10000,
  (p) => {
    router.classify(p);
  }
);

console.log(`\n1. ${coldBench.name}`);
console.log(`   Scope:       ${coldBench.description}`);
console.log(`   - Average:   ${coldBench.stats.avg.toFixed(2)} µs`);
console.log(`   - Min:       ${coldBench.stats.min.toFixed(2)} µs`);
console.log(`   - p50:       ${coldBench.stats.p50.toFixed(2)} µs`);
console.log(`   - p90:       ${coldBench.stats.p90.toFixed(2)} µs`);
console.log(`   - p99:       ${coldBench.stats.p99.toFixed(2)} µs`);
console.log(`   - Max:       ${coldBench.stats.max.toFixed(2)} µs`);
console.log(`   - Throughput: ${coldBench.opsPerSec.toLocaleString()} ops/sec`);

console.log(`\n2. ${warmBench.name}`);
console.log(`   Scope:       ${warmBench.description}`);
console.log(`   - Average:   ${warmBench.stats.avg.toFixed(2)} µs`);
console.log(`   - Min:       ${warmBench.stats.min.toFixed(2)} µs`);
console.log(`   - p50:       ${warmBench.stats.p50.toFixed(2)} µs`);
console.log(`   - p90:       ${warmBench.stats.p90.toFixed(2)} µs`);
console.log(`   - p99:       ${warmBench.stats.p99.toFixed(2)} µs`);
console.log(`   - Max:       ${warmBench.stats.max.toFixed(2)} µs`);
console.log(`   - Throughput: ${warmBench.opsPerSec.toLocaleString()} ops/sec`);

console.log('\n' + '='.repeat(72));
console.log('Summary:');
console.log(`Cold Regex Heuristic: ${coldBench.stats.p50.toFixed(1)} µs p50 (p99: ${coldBench.stats.p99.toFixed(1)} µs)`);
console.log(`Warm LRU Memo Hit:    ${warmBench.stats.p50.toFixed(1)} µs p50 (p99: ${warmBench.stats.p99.toFixed(1)} µs)`);
console.log('Note: Latency measures Stage-0 CPU classification/lookup overhead only,');
console.log('      not downstream LLM inference or network transport.');
console.log('='.repeat(72) + '\n');

