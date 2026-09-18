#!/usr/bin/env node

/**
 * scripts/harvest-ood.js
 * 
 * Harvests real-world traffic logs, isolates Stage-0 false positives (prompts that
 * fast-pathed but should have delegated to L2), and appends them to the OOD fixture suite.
 * Zero external dependencies.
 *
 * Usage:
 *   node scripts/harvest-ood.js <path-to-logs.jsonl> [options]
 *
 * Options:
 *   --target <path>      Target JSON fixture file (default: test/fixtures/ood-prompts.json)
 *   --category <name>    Category tag for harvested items (default: harvested_production)
 *   --dry-run            Simulate harvest and display findings without modifying the target file
 *   --force-all          Evaluate every prompt in log against classifier, adding any fast-path triggers
 *   --help, -h           Show this help message
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { classifyPreRoute } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FIXTURE_PATH = path.resolve(__dirname, '../test/fixtures/ood-prompts.json');

function printHelp() {
  console.log(`
Usage:
  node scripts/harvest-ood.js [path-to-logs.jsonl] [options]

Options:
  --target <path>    Target JSON fixture file (default: test/fixtures/ood-prompts.json)
  --category <name>  Category label for harvested prompts (default: harvested_production)
  --prepend          Prepend new traps to the start of the fixture file instead of appending
  --dry-run          Simulate without writing to target fixture
  --force-all        Test every prompt in log for false-positive triggers
  --help, -h         Show help
`);
}

function extractPromptString(record) {
  const raw = record.prompt ?? record.query ?? record.messages ?? record.input;
  if (!raw) return null;

  if (typeof raw === 'string') {
    return raw.trim();
  }

  if (Array.isArray(raw)) {
    // Extract the latest user message or concatenate messages
    const userMsgs = raw.filter(m => m && m.role === 'user' && typeof m.content === 'string');
    if (userMsgs.length > 0) {
      return userMsgs[userMsgs.length - 1].content.trim();
    }
    return raw.map(m => m.content ?? '').join('\n').trim();
  }

  return null;
}

function isStage0FalsePositive(record, promptText) {
  // 1. Explicit log indicators of downstream L2 override or human correction
  const hasOverrideFlag = (
    record.userOverride === true ||
    record.actualAction === 'delegate_to_l2' ||
    record.correctedAction === 'delegate_to_l2' ||
    record.overrideRole === 'delegate_to_l2' ||
    record.isFalsePositive === true ||
    record.wrongSpecialist === true
  );

  // 2. Evaluate current classifier behavior
  const currentResult = classifyPreRoute(promptText);

  // If explicitly flagged as an override, or if logged as fast-path with downstream correction
  if (hasOverrideFlag) {
    return { isTrap: true, triggeredRole: currentResult.role ?? record.result?.role };
  }

  // If force-all is enabled, any prompt that triggered fast-path is considered a candidate
  return { isTrap: false, triggeredRole: currentResult.role };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let logFilePath = null;
  let targetPath = DEFAULT_FIXTURE_PATH;
  let category = 'harvested_production';
  let dryRun = false;
  let forceAll = false;
  let prepend = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' && i + 1 < args.length) {
      targetPath = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--category' && i + 1 < args.length) {
      category = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force-all') {
      forceAll = true;
    } else if (arg === '--prepend') {
      prepend = true;
    } else if (!arg.startsWith('-') && !logFilePath) {
      logFilePath = path.resolve(process.cwd(), arg);
    }
  }

  // Fallback to sample traffic fixture if no log file argument is specified
  if (!logFilePath) {
    const defaultSamplePath = path.resolve(__dirname, '../test/fixtures/sample-traffic.jsonl');
    if (fs.existsSync(defaultSamplePath)) {
      logFilePath = defaultSamplePath;
    }
  }

  if (!logFilePath || !fs.existsSync(logFilePath)) {
    console.error(`❌ Error: Log file not found: ${logFilePath}`);
    process.exit(1);
  }

  // Load existing fixtures to deduplicate
  let existingFixtures = [];
  if (fs.existsSync(targetPath)) {
    try {
      existingFixtures = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    } catch (err) {
      console.error(`❌ Error reading existing fixture file at ${targetPath}:`, err.message);
      process.exit(1);
    }
  }

  const existingNormalized = new Set(
    existingFixtures.map(item => {
      const q = typeof item === 'string' ? item : item.query;
      return q.trim().toLowerCase().replace(/\s+/g, ' ');
    })
  );

  console.log(`\n======================================================`);
  console.log(`🌾 Krusch Pre-Router OOD Harvest Pipeline`);
  console.log(`======================================================`);
  console.log(`Source Log:       ${logFilePath}`);
  console.log(`Target Fixture:   ${targetPath}`);
  console.log(`Existing Fixtures: ${existingFixtures.length}`);
  console.log(`Mode:             ${dryRun ? 'DRY-RUN (Simulated)' : 'WRITE'}`);
  console.log(`======================================================\n`);

  const fileStream = fs.createReadStream(logFilePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let linesRead = 0;
  let candidatesFound = 0;
  let duplicatesSkipped = 0;
  const newTraps = [];

  for await (const line of rl) {
    linesRead++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      // Treat non-JSON line as plain prompt text if not empty
      record = { prompt: trimmed };
    }

    const promptText = extractPromptString(record);
    if (!promptText) continue;

    const normKey = promptText.trim().toLowerCase().replace(/\s+/g, ' ');
    if (existingNormalized.has(normKey)) {
      duplicatesSkipped++;
      continue;
    }

    const check = isStage0FalsePositive(record, promptText);
    if (check.isTrap || (forceAll && classifyPreRoute(promptText).isFastPath)) {
      candidatesFound++;
      existingNormalized.add(normKey);
      newTraps.push({
        category,
        query: promptText,
        harvestedAt: new Date().toISOString(),
        falselyTriggeredRole: check.triggeredRole
      });
    }
  }

  console.log(`Scan Results:`);
  console.log(`• Total Log Lines Parsed:    ${linesRead}`);
  console.log(`• Duplicates Skipped:        ${duplicatesSkipped}`);
  console.log(`• New OOD Traps Identified:  ${newTraps.length}`);

  if (newTraps.length > 0) {
    console.log(`\nSample Harvested Traps:`);
    for (const trap of newTraps.slice(0, 5)) {
      console.log(`  ➕ [${trap.falselyTriggeredRole ?? 'l2-override'}] "${trap.query.slice(0, 75)}"`);
    }
    if (newTraps.length > 5) {
      console.log(`  ... and ${newTraps.length - 5} more.`);
    }

    if (!dryRun) {
      const updatedFixtures = prepend 
        ? [...newTraps, ...existingFixtures] 
        : [...existingFixtures, ...newTraps];
      fs.writeFileSync(targetPath, JSON.stringify(updatedFixtures, null, 2) + '\n', 'utf8');
      console.log(`\n✅ Successfully wrote ${updatedFixtures.length} total fixtures to ${targetPath} (${prepend ? 'prepended' : 'appended'})`);
    }
  } else {
    console.log(`\n✨ No new OOD traps detected in provided logs.`);
  }

  if (dryRun) {
    console.log(`\n💡 Dry-run complete. No changes were written.`);
  }
  console.log(`======================================================\n`);
}

main().catch(err => {
  console.error('Fatal error during harvest:', err);
  process.exit(1);
});
