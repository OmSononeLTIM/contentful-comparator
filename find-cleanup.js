const https = require('https');
const fs = require('fs');
require('dotenv').config();

// Fetch all content models from a space
function fetchAllContentModels(spaceId, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.contentful.com',
      port: 443,
      path: `/spaces/${spaceId}/content_types?limit=1000`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned status ${res.statusCode}: ${data}`));
          return;
        }

        try {
          const response = JSON.parse(data);
          resolve(response.items || []);
        } catch (error) {
          reject(new Error(`Failed to parse API response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

// Main function
async function main() {
  try {
    const outputLines = [];
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const outputFileName = `cleanup-analysis_${dateStr}_${timeStr}.txt`;

    const pilotSpaceId = process.env.PILOT_SPACE_ID;
    const pilotAccessToken = process.env.PILOT_ACCESS_TOKEN;
    const rolloutSpaceId = process.env.ROLLOUT_SPACE_ID;
    const rolloutAccessToken = process.env.ROLLOUT_ACCESS_TOKEN;

    if (!pilotSpaceId || !pilotAccessToken || !rolloutSpaceId || !rolloutAccessToken) {
      console.error('\n❌ Error: Missing environment variables.');
      console.error('Please ensure .env file contains:');
      console.error('  - PILOT_SPACE_ID');
      console.error('  - PILOT_ACCESS_TOKEN');
      console.error('  - ROLLOUT_SPACE_ID');
      console.error('  - ROLLOUT_ACCESS_TOKEN\n');
      process.exit(1);
    }

    // Helper function to log to both console and file
    const log = (message) => {
      console.log(message);
      outputLines.push(message);
    };

    log('\n🔍 Analyzing content models across spaces...');
    log(`   Pilot Space:   ${pilotSpaceId}`);
    log(`   Rollout Space: ${rolloutSpaceId}\n`);

    outputLines.push('═'.repeat(70));
    outputLines.push('           CONTENTFUL CLEANUP ANALYSIS REPORT');
    outputLines.push('═'.repeat(70));
    outputLines.push(`Date: ${new Date().toLocaleString()}`);
    outputLines.push(`Pilot Space ID: ${pilotSpaceId}`);
    outputLines.push(`Rollout Space ID: ${rolloutSpaceId}`);
    outputLines.push('');

    // Fetch all models from both spaces
    console.log('⏳ Fetching all models from Pilot space...');
    const pilotModels = await fetchAllContentModels(pilotSpaceId, pilotAccessToken);
    log(`✅ Found ${pilotModels.length} models in Pilot`);

    console.log('⏳ Fetching all models from Rollout space...');
    const rolloutModels = await fetchAllContentModels(rolloutSpaceId, rolloutAccessToken);
    log(`✅ Found ${rolloutModels.length} models in Rollout\n`);

    // Create maps for comparison
    const pilotModelIds = new Set(pilotModels.map(m => m.sys.id));
    const rolloutModelIds = new Set(rolloutModels.map(m => m.sys.id));

    // Find models in Rollout that are NOT in Pilot
    const modelsToRemove = rolloutModels.filter(m => !pilotModelIds.has(m.sys.id));

    // Find models in Pilot that are NOT in Rollout
    const modelsToAdd = pilotModels.filter(m => !rolloutModelIds.has(m.sys.id));

    // Find common models
    const commonModels = rolloutModels.filter(m => pilotModelIds.has(m.sys.id));

    log('═'.repeat(70));
    log('📊 SPACE COMPARISON SUMMARY');
    log('═'.repeat(70));
    log(`\n   Pilot Space:    ${pilotModels.length} models`);
    log(`   Rollout Space:  ${rolloutModels.length} models`);
    log(`\n   Common models:  ${commonModels.length}`);
    log(`   Only in Pilot:  ${modelsToAdd.length}`);
    log(`   Only in Rollout: ${modelsToRemove.length}\n`);

    // Show models that can be removed from Rollout
    if (modelsToRemove.length > 0) {
      log('═'.repeat(70));
      log('🗑️  MODELS TO REMOVE FROM ROLLOUT');
      log('═'.repeat(70));
      log(`\n   These ${modelsToRemove.length} model(s) exist in Rollout but NOT in Pilot:`);
      log('   Removing them will free up space for new models.\n');

      modelsToRemove
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((model, index) => {
          log(`   ${(index + 1).toString().padStart(3)}. ${model.name.padEnd(45)} (${model.sys.id})`);
        });

      log(`\n   ⚠️  Removing these ${modelsToRemove.length} model(s) will free up space in Rollout.`);
      log('   ⚠️  Make sure these models are truly not needed before deleting!\n');
    } else {
      log('═'.repeat(70));
      log('✅ NO MODELS TO REMOVE');
      log('═'.repeat(70));
      log('\n   All models in Rollout also exist in Pilot.');
      log('   No cleanup needed.\n');
    }

    // Show models that should be added to Rollout
    if (modelsToAdd.length > 0) {
      log('═'.repeat(70));
      log('➕ MODELS MISSING IN ROLLOUT');
      log('═'.repeat(70));
      log(`\n   These ${modelsToAdd.length} model(s) exist in Pilot but NOT in Rollout:`);
      log('   These should be imported to Rollout.\n');

      modelsToAdd
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((model, index) => {
          log(`   ${(index + 1).toString().padStart(3)}. ${model.name.padEnd(45)} (${model.sys.id})`);
        });

      log('');
    }

    // Space availability check
    log('═'.repeat(70));
    log('💾 SPACE AVAILABILITY');
    log('═'.repeat(70));
    
    const rolloutLimit = 300;
    const rolloutUsed = rolloutModels.length;
    const rolloutAvailable = rolloutLimit - rolloutUsed;
    const spaceNeeded = modelsToAdd.length;
    const spaceAfterCleanup = rolloutAvailable + modelsToRemove.length;

    log(`\n   Rollout current:     ${rolloutUsed}/${rolloutLimit} models`);
    log(`   Available now:       ${rolloutAvailable} slots`);
    log(`   Models to import:    ${spaceNeeded} models`);
    
    if (modelsToRemove.length > 0) {
      log(`   After cleanup:       ${spaceAfterCleanup} slots available`);
    }

    if (spaceNeeded > rolloutAvailable && modelsToRemove.length > 0) {
      const stillShort = spaceNeeded - spaceAfterCleanup;
      if (stillShort > 0) {
        log(`\n   ⚠️  WARNING: Even after cleanup, you'll be ${stillShort} model(s) short!`);
        log(`   You need to remove ${stillShort} more model(s) from Rollout.`);
      } else {
        log(`\n   ✅ After cleanup, you'll have enough space to import all models.`);
      }
    } else if (spaceNeeded > rolloutAvailable) {
      log(`\n   ❌ Not enough space! You need ${spaceNeeded - rolloutAvailable} more slot(s).`);
      log(`   Consider removing unused models from Rollout.`);
    } else {
      log(`\n   ✅ Enough space available to import all ${spaceNeeded} model(s).`);
    }

    log('');
    log('═'.repeat(70));
    log('');

    // Write output to file
    fs.writeFileSync(outputFileName, outputLines.join('\n'), 'utf8');
    console.log(`\n📄 Report saved to: ${outputFileName}\n`);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
