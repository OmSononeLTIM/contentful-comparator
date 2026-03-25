#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
require('dotenv').config({ debug: process.env.DEBUG });

/**
 * Contentful Model Import Script
 * 
 * This script imports content models from Pilot space to Rollout space.
 * It can import individual models or multiple models from the config file.
 * 
 * Usage:
 *   node import-models.js                         # Interactive mode - choose from list
 *   node import-models.js modelId                 # Import specific model by ID
 *   node import-models.js --from-config           # Import models from modelsToImport array
 *   node import-models.js --from-config --dry-run # Preview import from config
 *   node import-models.js --all                   # Import all models from modelsToCompare
 *   node import-models.js --dry-run modelId       # Preview without making changes
 */

// HTTPS request helper
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    
    req.end();
  });
}

// Fetch a single content model from a space
async function fetchContentModel(spaceId, environment, accessToken, modelId) {
  const options = {
    hostname: 'api.contentful.com',
    path: `/spaces/${spaceId}/environments/${environment}/content_types/${modelId}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    return await makeRequest(options);
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

// Check if content model exists in Rollout
async function checkModelExists(spaceId, environment, accessToken, modelId) {
  const model = await fetchContentModel(spaceId, environment, accessToken, modelId);
  return model !== null;
}

// Normalize fields to remove locale-specific data
function normalizeFields(fields) {
  return fields.map(field => {
    const normalizedField = { ...field };
    
    // Handle defaultValue - if it's a locale-keyed object, remove it to avoid conflicts
    if (normalizedField.defaultValue && typeof normalizedField.defaultValue === 'object') {
      // Check if it's a locale-keyed object (e.g., {"en-GB": false})
      const keys = Object.keys(normalizedField.defaultValue);
      if (keys.length > 0 && keys[0].includes('-')) {
        // It's locale-keyed - remove it to avoid locale conflicts
        // The target space will use its own locale configuration
        delete normalizedField.defaultValue;
        console.log(`   ℹ️  Removed locale-specific defaultValue from field "${field.name}"`);
      }
    }
    
    return normalizedField;
  });
}

// Create a new content model in Rollout
async function createContentModel(spaceId, environment, accessToken, modelData) {
  const options = {
    hostname: 'api.contentful.com',
    path: `/spaces/${spaceId}/environments/${environment}/content_types/${modelData.sys.id}`,
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.contentful.management.v1+json',
      'X-Contentful-Content-Type': modelData.sys.id
    }
  };

  // Prepare payload - remove sys metadata and normalize fields
  const payload = {
    name: modelData.name,
    description: modelData.description || '',
    displayField: modelData.displayField,
    fields: normalizeFields(modelData.fields)
  };

  return await makeRequest(options, payload);
}

// Update existing content model in Rollout
async function updateContentModel(spaceId, environment, accessToken, modelData, currentVersion) {
  const options = {
    hostname: 'api.contentful.com',
    path: `/spaces/${spaceId}/environments/${environment}/content_types/${modelData.sys.id}`,
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.contentful.management.v1+json',
      'X-Contentful-Content-Type': modelData.sys.id,
      'X-Contentful-Version': currentVersion.toString()
    }
  };

  // Prepare payload - remove sys metadata and normalize fields
  const payload = {
    name: modelData.name,
    description: modelData.description || '',
    displayField: modelData.displayField,
    fields: normalizeFields(modelData.fields)
  };

  return await makeRequest(options, payload);
}

// Publish a content model
async function publishContentModel(spaceId, environment, accessToken, modelId, version) {
  const options = {
    hostname: 'api.contentful.com',
    path: `/spaces/${spaceId}/environments/${environment}/content_types/${modelId}/published`,
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Contentful-Version': version.toString()
    }
  };

  return await makeRequest(options);
}

// Read config file
function readConfig(configPath = './config.json') {
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error reading config file: ${error.message}`);
    process.exit(1);
  }
}

// Interactive model selection
async function selectModel(modelsList) {
  console.log('\n📋 Available models to import:\n');
  modelsList.forEach((model, index) => {
    console.log(`   ${(index + 1).toString().padStart(3)}. ${model}`);
  });
  console.log('\n💡 Tip: You can also run: node import-models.js <modelId>');
  console.log('💡 Or import from config: node import-models.js --from-config');
  console.log('💡 Or import all: node import-models.js --all\n');
  
  process.stdout.write('Enter model number or ID to import (or "q" to quit): ');
  
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const input = data.toString().trim();
      
      if (input.toLowerCase() === 'q') {
        console.log('\n👋 Cancelled.\n');
        process.exit(0);
      }
      
      // Check if it's a number (index)
      const num = parseInt(input);
      if (!isNaN(num) && num > 0 && num <= modelsList.length) {
        resolve(modelsList[num - 1]);
      } else if (modelsList.includes(input)) {
        resolve(input);
      } else {
        console.log(`\n❌ Invalid selection: ${input}\n`);
        process.exit(1);
      }
    });
  });
}

// Import a single model
async function importModel(modelId, pilotConfig, rolloutConfig, dryRun = false) {
  const { spaceId: pilotSpace, environment: pilotEnv, accessToken: pilotToken } = pilotConfig;
  const { spaceId: rolloutSpace, environment: rolloutEnv, accessToken: rolloutToken } = rolloutConfig;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📦 ${dryRun ? '[DRY RUN] ' : ''}Importing: ${modelId}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Step 1: Fetch from Pilot
  console.log(`⏳ Fetching model from Pilot (${pilotSpace}/${pilotEnv})...`);
  const pilotModel = await fetchContentModel(pilotSpace, pilotEnv, pilotToken, modelId);
  
  if (!pilotModel) {
    console.log(`❌ Model "${modelId}" not found in Pilot space.`);
    return { success: false, modelId, error: 'Not found in Pilot' };
  }
  
  console.log(`✅ Found in Pilot: "${pilotModel.name}"`);
  console.log(`   Fields: ${pilotModel.fields.length}`);
  console.log(`   Display Field: ${pilotModel.displayField || 'None'}`);

  // Step 2: Check if exists in Rollout
  console.log(`\n⏳ Checking Rollout (${rolloutSpace}/${rolloutEnv})...`);
  const rolloutModel = await fetchContentModel(rolloutSpace, rolloutEnv, rolloutToken, modelId);
  
  const isUpdate = rolloutModel !== null;
  
  if (isUpdate) {
    console.log(`⚠️  Model already exists in Rollout (version ${rolloutModel.sys.version})`);
    console.log(`   Will UPDATE existing model`);
  } else {
    console.log(`✅ Model does not exist in Rollout`);
    console.log(`   Will CREATE new model`);
  }

  if (dryRun) {
    console.log(`\n🔍 DRY RUN - No changes will be made.`);
    console.log(`\n   Action: ${isUpdate ? 'UPDATE' : 'CREATE'} "${pilotModel.name}" (${modelId})`);
    console.log(`   Fields to ${isUpdate ? 'sync' : 'create'}: ${pilotModel.fields.length}`);
    
    if (isUpdate) {
      // Show differences
      const addedFields = pilotModel.fields.filter(pf => 
        !rolloutModel.fields.find(rf => rf.id === pf.id)
      );
      const removedFields = rolloutModel.fields.filter(rf => 
        !pilotModel.fields.find(pf => pf.id === rf.id)
      );
      
      if (addedFields.length > 0) {
        console.log(`\n   ➕ Fields to add: ${addedFields.length}`);
        addedFields.forEach(f => console.log(`      - ${f.name} (${f.id})`));
      }
      
      if (removedFields.length > 0) {
        console.log(`\n   ➖ Fields to remove: ${removedFields.length}`);
        removedFields.forEach(f => console.log(`      - ${f.name} (${f.id})`));
      }
      
      if (addedFields.length === 0 && removedFields.length === 0) {
        console.log(`\n   ℹ️  No field changes (may have field definition updates)`);
      }
    }
    
    console.log(`\n✅ Dry run complete. Use without --dry-run to execute.\n`);
    return { success: true, modelId, dryRun: true, action: isUpdate ? 'UPDATE' : 'CREATE' };
  }

  // Step 3: Create or Update
  console.log(`\n⏳ ${isUpdate ? 'Updating' : 'Creating'} model in Rollout...`);
  
  try {
    let result;
    if (isUpdate) {
      result = await updateContentModel(
        rolloutSpace,
        rolloutEnv,
        rolloutToken,
        pilotModel,
        rolloutModel.sys.version
      );
    } else {
      result = await createContentModel(
        rolloutSpace,
        rolloutEnv,
        rolloutToken,
        pilotModel
      );
    }
    
    console.log(`✅ Model ${isUpdate ? 'updated' : 'created'} successfully (version ${result.sys.version})`);
    
    // Step 4: Publish
    console.log(`\n⏳ Publishing model...`);
    await publishContentModel(rolloutSpace, rolloutEnv, rolloutToken, modelId, result.sys.version);
    console.log(`✅ Model published successfully`);
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ Import complete: ${modelId}`);
    console.log(`${'═'.repeat(70)}\n`);
    
    return { success: true, modelId, action: isUpdate ? 'UPDATE' : 'CREATE' };
    
  } catch (error) {
    console.log(`\n❌ Error: ${error.message}\n`);
    return { success: false, modelId, error: error.message };
  }
}

// Main function
async function main() {
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const importAll = args.includes('--all');
    const fromConfig = args.includes('--from-config');
    const modelArg = args.find(arg => !arg.startsWith('--'));

    // Load environment variables
    const pilotSpaceId = process.env.PILOT_SPACE_ID;
    const pilotAccessToken = process.env.PILOT_ACCESS_TOKEN;
    const pilotEnvironment = process.env.PILOT_ENVIRONMENT || 'master';
    
    const rolloutSpaceId = process.env.ROLLOUT_SPACE_ID;
    const rolloutAccessToken = process.env.ROLLOUT_ACCESS_TOKEN;
    const rolloutEnvironment = process.env.ROLLOUT_ENVIRONMENT || 'master';

    if (!pilotSpaceId || !pilotAccessToken || !rolloutSpaceId || !rolloutAccessToken) {
      console.error('\n❌ Error: Missing environment variables.');
      console.error('Please ensure .env file contains:');
      console.error('  - PILOT_SPACE_ID');
      console.error('  - PILOT_ACCESS_TOKEN');
      console.error('  - PILOT_ENVIRONMENT (optional, defaults to "master")');
      console.error('  - ROLLOUT_SPACE_ID');
      console.error('  - ROLLOUT_ACCESS_TOKEN');
      console.error('  - ROLLOUT_ENVIRONMENT (optional, defaults to "master")\n');
      process.exit(1);
    }

    const pilotConfig = {
      spaceId: pilotSpaceId,
      environment: pilotEnvironment,
      accessToken: pilotAccessToken
    };

    const rolloutConfig = {
      spaceId: rolloutSpaceId,
      environment: rolloutEnvironment,
      accessToken: rolloutAccessToken
    };

    console.log('\n🚀 Contentful Model Import Tool');
    console.log(`${'═'.repeat(70)}`);
    console.log(`Pilot:   ${pilotSpaceId}/${pilotEnvironment}`);
    console.log(`Rollout: ${rolloutSpaceId}/${rolloutEnvironment}`);
    if (dryRun) {
      console.log(`\n⚠️  DRY RUN MODE - No changes will be made`);
    }
    console.log(`${'═'.repeat(70)}`);

    // Load config
    const config = readConfig();
    const modelsToImport = config.modelsToImport || [];
    const modelsList = config.modelsToCompare || [];

    // Determine which models to import
    let modelsForImport = [];

    if (fromConfig) {
      // Use modelsToImport from config
      if (modelsToImport.length === 0) {
        console.error('\n❌ No models found in config.json (modelsToImport array is empty).');
        console.error('Add model IDs to the "modelsToImport" array in config.json\n');
        process.exit(1);
      }
      modelsForImport = modelsToImport;
      console.log(`\n📦 Importing ${modelsToImport.length} model(s) from config.modelsToImport...`);
      console.log(`   Models: ${modelsToImport.slice(0, 5).join(', ')}${modelsToImport.length > 5 ? '...' : ''}\n`);
    } else if (importAll) {
      // Use all models from modelsToCompare
      if (modelsList.length === 0) {
        console.error('\n❌ No models found in config.json (modelsToCompare array is empty).\n');
        process.exit(1);
      }
      modelsForImport = modelsList;
      console.log(`\n📦 Importing ALL ${modelsList.length} models from config.modelsToCompare...\n`);
    } else if (modelArg) {
      // Import specific model by ID
      const allModels = [...new Set([...modelsToImport, ...modelsList])];
      if (!allModels.includes(modelArg)) {
        console.error(`\n❌ Model "${modelArg}" not found in config.json`);
        console.error(`Available models: ${allModels.slice(0, 5).join(', ')}...\n`);
        process.exit(1);
      }
      modelsForImport = [modelArg];
    } else {
      // Interactive mode - show all available models
      const allModels = [...new Set([...modelsToImport, ...modelsList])];
      if (allModels.length === 0) {
        console.error('\n❌ No models found in config.json.\n');
        process.exit(1);
      }
      process.stdin.setRawMode(false);
      process.stdin.resume();
      const selectedModel = await selectModel(allModels);
      modelsForImport = [selectedModel];
    }

    // Import models
    const results = [];
    for (let i = 0; i < modelsForImport.length; i++) {
      const modelId = modelsForImport[i];
      
      if (modelsForImport.length > 1) {
        console.log(`\n[${ i + 1}/${modelsForImport.length}]`);
      }
      
      const result = await importModel(modelId, pilotConfig, rolloutConfig, dryRun);
      results.push(result);
      
      // Add delay between imports to avoid rate limiting
      if (i < modelsForImport.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Summary
    if (results.length > 1) {
      console.log(`\n${'═'.repeat(70)}`);
      console.log('📊 IMPORT SUMMARY');
      console.log(`${'═'.repeat(70)}\n`);
      
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      
      console.log(`✅ Successful: ${successful.length}`);
      if (failed.length > 0) {
        console.log(`❌ Failed: ${failed.length}`);
        failed.forEach(r => {
          console.log(`   - ${r.modelId}: ${r.error}`);
        });
      }
      
      if (dryRun) {
        console.log(`\n⚠️  This was a DRY RUN. No changes were made.`);
        console.log(`   Remove --dry-run flag to execute imports.\n`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Fatal Error: ${error.message}\n`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Only run if executed directly
if (require.main === module) {
  main();
}

module.exports = { importModel, fetchContentModel };
