import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';

// Function to escape single quotes for SQL strings
function escapeSqlString(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    // Replace single quotes with two single quotes
    return "'" + value.replace(/'/g, "''") + "'";
}

function generateInsertSql() {
    console.log('Starting SQL generation...');

    // --- 1. Read and Parse CSV --- 
    const csvPath = join(process.cwd(), 'static', 'data_full.csv');
    const outputSqlPath = join(process.cwd(), 'scripts', 'insert_data.sql');
    let records;
    try {
        console.log(`Reading CSV from: ${csvPath}`);
        const fileContent = readFileSync(csvPath);
        records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        console.log(`Parsed ${records.length} records from CSV.`);
        if (records.length === 0) {
             console.log('CSV file is empty or invalid. No SQL generated.');
             process.exit(0);
        }
    } catch (e) {
        console.error('Error reading or parsing CSV:', e);
        process.exit(1);
    }

    // --- 2. Generate INSERT Statements --- 
    let sqlStatements = [
        '-- Generated SQL statements for initial data insertion --',
        '-- Run this file against your D1 database using: wrangler d1 execute <DB_NAME> --file scripts/insert_data.sql --remote --',
        'PRAGMA foreign_keys=off;'
    ];
    let skippedCount = 0;
    let generatedCount = 0;

    const baseStmt = 'INSERT INTO articles (id, title, alltext) VALUES ';

    for (const record of records) {
        if (record.id && record.title && record.alltext && !isNaN(parseInt(record.id, 10))) {
            const id = parseInt(record.id, 10);
            const title = escapeSqlString(record.title);
            const alltext = escapeSqlString(record.alltext);
            sqlStatements.push(`${baseStmt}(${id}, ${title}, ${alltext});`);
            generatedCount++;
        } else {
             console.warn('Skipping invalid record for SQL generation:', record);
             skippedCount++;
        }
    }

    sqlStatements.push('PRAGMA foreign_keys=on;');

    // --- 3. Write to SQL file --- 
    try {
        console.log(`Writing ${generatedCount} INSERT statements to: ${outputSqlPath}`);
        writeFileSync(outputSqlPath, sqlStatements.join('\n'), 'utf8');
        console.log(`Successfully generated SQL file. Skipped ${skippedCount} invalid records.`);
        console.log('\nNext step: Run the wrangler command shown in the SQL file comments!\n');
    } catch (e) {
        console.error('Error writing SQL file:', e);
        process.exit(1);
    }
}

generateInsertSql(); 