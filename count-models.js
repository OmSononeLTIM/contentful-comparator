const https = require('https');
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
let spaceId, accessToken, spaceName;

// Check if space is specified via command line
if (args.length >= 2) {
  spaceId = args[0];
  accessToken = args[1];
  spaceName = args[2] || spaceId;
} else if (args.length === 1) {
  // Check for shortcuts: 'pilot' or 'rollout'
  const spaceType = args[0].toLowerCase();
  
  if (spaceType === 'pilot') {
    spaceId = process.env.PILOT_SPACE_ID;
    accessToken = process.env.PILOT_ACCESS_TOKEN;
    spaceName = 'Pilot';
  } else if (spaceType === 'rollout') {
    spaceId = process.env.ROLLOUT_SPACE_ID;
    accessToken = process.env.ROLLOUT_ACCESS_TOKEN;
    spaceName = 'Rollout';
  } else {
    console.error('Invalid space type. Use "pilot" or "rollout", or provide spaceId and accessToken.');
    process.exit(1);
  }
} else {
  console.error('\nUsage:');
  console.error('  node count-models.js pilot');
  console.error('  node count-models.js rollout');
  console.error('  node count-models.js <spaceId> <accessToken> [spaceName]\n');
  console.error('Or use npm scripts:');
  console.error('  npm run count-pilot');
  console.error('  npm run count-rollout\n');
  process.exit(1);
}

// Fetch content models count
function countContentModels(spaceId, accessToken) {
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
          resolve(response);
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
    console.log(`\n🔍 Counting content models in ${spaceName} space...`);
    console.log(`   Space ID: ${spaceId}\n`);

    const response = await countContentModels(spaceId, accessToken);
    const models = response.items || [];
    const totalCount = models.length;
    const limit = 300;
    const remaining = limit - totalCount;
    const percentUsed = ((totalCount / limit) * 100).toFixed(1);

    console.log('═'.repeat(60));
    console.log(`📊 CONTENT MODEL COUNT - ${spaceName.toUpperCase()} SPACE`);
    console.log('═'.repeat(60));
    console.log(`\n   Total Models:     ${totalCount}`);
    console.log(`   Contentful Limit: ${limit}`);
    console.log(`   Remaining:        ${remaining}`);
    console.log(`   Usage:            ${percentUsed}%`);

    // Visual bar
    const barLength = 50;
    const filledLength = Math.round((totalCount / limit) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    console.log(`\n   [${bar}] ${percentUsed}%\n`);

    // Warning if close to limit
    if (totalCount >= 270) {
      console.log('   ⚠️  WARNING: Approaching content model limit!');
      console.log(`   Only ${remaining} models remaining.\n`);
    } else if (totalCount >= 240) {
      console.log('   ⚠️  Getting close to limit.');
      console.log(`   ${remaining} models remaining.\n`);
    } else {
      console.log(`   ✅ ${remaining} models available.\n`);
    }

    // List all models
    if (totalCount > 0) {
      console.log('═'.repeat(60));
      console.log('📋 ALL CONTENT MODELS:');
      console.log('═'.repeat(60));
      console.log('');
      
      models
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((model, index) => {
          console.log(`   ${(index + 1).toString().padStart(3)}. ${model.name.padEnd(40)} (${model.sys.id})`);
        });
      
      console.log('');
    }

    console.log('═'.repeat(60));
    console.log('');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
