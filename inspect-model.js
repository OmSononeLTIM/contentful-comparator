#!/usr/bin/env node

const https = require('https');
require('dotenv').config({ debug: process.env.DEBUG });

// HTTPS request helper
function makeRequest(options) {
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
    req.end();
  });
}

// Fetch a single content model
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

  return await makeRequest(options);
}

// Check if a field has locale-specific properties
function findLocaleSpecificFields(fields) {
  const localeFields = [];
  
  fields.forEach(field => {
    const localeProps = [];
    
    // Check common locale-specific properties
    if (field.defaultValue && typeof field.defaultValue === 'object') {
      Object.keys(field.defaultValue).forEach(key => {
        if (key.includes('-')) { // Locale codes have format like "en-GB", "pl-PL"
          localeProps.push({ property: 'defaultValue', locale: key, value: field.defaultValue[key] });
        }
      });
    }
    
    // Check validations
    if (field.validations) {
      field.validations.forEach((validation, idx) => {
        const validationStr = JSON.stringify(validation);
        if (validationStr.includes('en-GB') || validationStr.includes('pl-PL')) {
          localeProps.push({ property: `validations[${idx}]`, data: validation });
        }
      });
    }
    
    // Check items (for Array fields)
    if (field.items && field.items.validations) {
      field.items.validations.forEach((validation, idx) => {
        const validationStr = JSON.stringify(validation);
        if (validationStr.includes('en-GB') || validationStr.includes('pl-PL')) {
          localeProps.push({ property: `items.validations[${idx}]`, data: validation });
        }
      });
    }
    
    if (localeProps.length > 0) {
      localeFields.push({
        fieldId: field.id,
        fieldName: field.name,
        fieldType: field.type,
        localeSpecificData: localeProps
      });
    }
  });
  
  return localeFields;
}

async function main() {
  const modelId = process.argv[2] || 'dtcProductOverviewBlock';
  
  const pilotSpaceId = process.env.PILOT_SPACE_ID;
  const pilotAccessToken = process.env.PILOT_ACCESS_TOKEN;
  const pilotEnvironment = process.env.PILOT_ENVIRONMENT || 'master';

  if (!pilotSpaceId || !pilotAccessToken) {
    console.error('❌ Missing PILOT_SPACE_ID or PILOT_ACCESS_TOKEN in .env file');
    process.exit(1);
  }

  console.log(`\n🔍 Inspecting model: ${modelId}`);
  console.log(`   Space: ${pilotSpaceId}/${pilotEnvironment}\n`);

  try {
    const model = await fetchContentModel(pilotSpaceId, pilotEnvironment, pilotAccessToken, modelId);
    
    console.log(`📦 Model: "${model.name}" (${model.sys.id})`);
    console.log(`   Fields: ${model.fields.length}`);
    console.log(`   Display Field: ${model.displayField || 'None'}\n`);

    // Find locale-specific fields
    const localeFields = findLocaleSpecificFields(model.fields);
    
    if (localeFields.length === 0) {
      console.log('✅ No locale-specific field data found.\n');
    } else {
      console.log(`⚠️  Found ${localeFields.length} field(s) with locale-specific data:\n`);
      
      localeFields.forEach((field, index) => {
        console.log(`${index + 1}. Field: "${field.fieldName}" (${field.fieldId}) - Type: ${field.fieldType}`);
        field.localeSpecificData.forEach(data => {
          if (data.locale) {
            console.log(`   └─ ${data.property}[${data.locale}] = ${JSON.stringify(data.value)}`);
          } else {
            console.log(`   └─ ${data.property}: ${JSON.stringify(data.data, null, 2).split('\n').join('\n      ')}`);
          }
        });
        console.log('');
      });
    }
    
    // Show full field structure for reference
    console.log(`\n${'═'.repeat(70)}`);
    console.log('FULL FIELD STRUCTURE (for reference)');
    console.log(`${'═'.repeat(70)}\n`);
    
    model.fields.forEach((field, idx) => {
      console.log(`${idx + 1}. ${field.name} (${field.id}) - ${field.type}`);
      console.log(`   Localized: ${field.localized}`);
      console.log(`   Required: ${field.required}`);
      if (field.defaultValue) {
        console.log(`   DefaultValue: ${JSON.stringify(field.defaultValue)}`);
      }
      if (field.validations && field.validations.length > 0) {
        console.log(`   Validations: ${JSON.stringify(field.validations)}`);
      }
      console.log('');
    });

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
