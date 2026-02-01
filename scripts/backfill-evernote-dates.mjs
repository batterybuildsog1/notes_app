#!/usr/bin/env node
/**
 * Backfill Evernote Notes - Extract original timestamps from content
 * 
 * Parses the metadata section in Evernote notes for:
 *   **Created**: 2023-05-02 17:11
 *   **Updated**: 2023-05-02 17:19
 * 
 * Updates original_created_at and original_updated_at columns.
 * Assumes dates are in America/Denver timezone.
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
function loadEnv() {
  const envPath = resolve(__dirname, '../.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in .env.local');
  process.exit(1);
}

// Regex patterns for Evernote metadata
const CREATED_PATTERN = /\*\*Created\*\*:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/;
const UPDATED_PATTERN = /\*\*Updated\*\*:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/;

/**
 * Convert a date string in America/Denver timezone to UTC ISO string
 * @param {string} dateStr - Date in format YYYY-MM-DD
 * @param {string} timeStr - Time in format HH:MM
 * @returns {string} - ISO string in UTC
 */
function denverToUTC(dateStr, timeStr) {
  // Parse as local time in Denver timezone
  // Create a date string that JavaScript can parse, then adjust for Denver offset
  const localStr = `${dateStr}T${timeStr}:00`;
  
  // Get the offset for Denver on this specific date
  // America/Denver is UTC-7 (standard) or UTC-6 (daylight saving)
  const tempDate = new Date(localStr);
  
  // Use Intl to get the actual offset for Denver on this date
  const denverFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Create the date assuming it's already in Denver time
  // We need to find what UTC time corresponds to this Denver local time
  
  // Parse the date/time components
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  
  // Create a Date object interpreting the time as Denver local time
  // by using the timezone offset
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  
  // Now we need to find the offset for Denver at this approximate time
  // We'll use a trick: format a known UTC time as Denver time and compare
  const testOptions = { timeZone: 'America/Denver', hour: 'numeric', hour12: false };
  
  // Get Denver offset by checking what hour it is in Denver for a known UTC hour
  // This is approximate but works for determining DST
  const utcTestDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const denverHour = parseInt(new Intl.DateTimeFormat('en-US', testOptions).format(utcTestDate));
  const offset = 12 - denverHour; // positive means Denver is behind UTC
  
  // Adjust our date by adding the offset (since we interpreted as UTC but it was Denver time)
  const correctedDate = new Date(utcDate.getTime() + offset * 60 * 60 * 1000);
  
  return correctedDate.toISOString();
}

/**
 * Parse dates from note content
 * @param {string} content - Note content in markdown
 * @returns {{ created: string|null, updated: string|null }}
 */
function parseDates(content) {
  let created = null;
  let updated = null;
  
  const createdMatch = content.match(CREATED_PATTERN);
  if (createdMatch) {
    try {
      created = denverToUTC(createdMatch[1], createdMatch[2]);
    } catch (e) {
      console.warn(`  Failed to parse created date: ${createdMatch[0]}`);
    }
  }
  
  const updatedMatch = content.match(UPDATED_PATTERN);
  if (updatedMatch) {
    try {
      updated = denverToUTC(updatedMatch[1], updatedMatch[2]);
    } catch (e) {
      console.warn(`  Failed to parse updated date: ${updatedMatch[0]}`);
    }
  }
  
  return { created, updated };
}

async function main() {
  console.log('Backfill Evernote Original Timestamps');
  console.log('=====================================\n');
  
  const client = new pg.Client({ connectionString: DATABASE_URL });
  
  try {
    await client.connect();
    console.log('Connected to database\n');
    
    // Find all Evernote notes that need backfilling
    const { rows: notes } = await client.query(`
      SELECT id, title, content 
      FROM notes 
      WHERE source = 'evernote' 
        AND original_created_at IS NULL
      ORDER BY id
    `);
    
    console.log(`Found ${notes.length} Evernote notes to process\n`);
    
    let updated = 0;
    let failed = 0;
    const failures = [];
    
    for (const note of notes) {
      const { created, updated: updatedDate } = parseDates(note.content || '');
      
      if (created || updatedDate) {
        await client.query(`
          UPDATE notes 
          SET original_created_at = $1,
              original_updated_at = $2
          WHERE id = $3
        `, [created, updatedDate, note.id]);
        
        updated++;
        console.log(`✓ [${note.id}] "${note.title.slice(0, 50)}..." → created: ${created?.slice(0, 10) || 'N/A'}, updated: ${updatedDate?.slice(0, 10) || 'N/A'}`);
      } else {
        failed++;
        failures.push({ id: note.id, title: note.title });
        console.log(`✗ [${note.id}] "${note.title.slice(0, 50)}..." → No dates found in content`);
      }
    }
    
    console.log('\n=====================================');
    console.log('Summary');
    console.log('=====================================');
    console.log(`Total processed: ${notes.length}`);
    console.log(`Successfully updated: ${updated}`);
    console.log(`Failed to parse: ${failed}`);
    
    if (failures.length > 0) {
      console.log('\nNotes without parseable dates:');
      for (const f of failures) {
        console.log(`  - [${f.id}] ${f.title}`);
      }
    }
    
  } catch (error) {
    console.error('Database error:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed.');
  }
}

main();
