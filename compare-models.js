const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

// Read config file
const configPath = process.argv[2] || './config.json';
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Override with environment variables if they exist
  if (process.env.PILOT_SPACE_ID) {
    config.spaces.pilot.spaceId = process.env.PILOT_SPACE_ID;
  }
  if (process.env.PILOT_ACCESS_TOKEN) {
    config.spaces.pilot.accessToken = process.env.PILOT_ACCESS_TOKEN;
  }
  if (process.env.ROLLOUT_SPACE_ID) {
    config.spaces.rollout.spaceId = process.env.ROLLOUT_SPACE_ID;
  }
  if (process.env.ROLLOUT_ACCESS_TOKEN) {
    config.spaces.rollout.accessToken = process.env.ROLLOUT_ACCESS_TOKEN;
  }
} catch (error) {
  console.error('Error reading config file:', error.message);
  process.exit(1);
}

// Fetch content models from Contentful API
async function fetchContentModels(spaceId, accessToken, modelIds) {
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
          const allModels = response.items || [];

          // Filter to only the models we want to compare (by ID)
          const filteredModels = allModels.filter(ct => 
            modelIds.includes(ct.sys.id)
          );

          if (filteredModels.length === 0) {
            console.warn(`⚠️  No models from the config list found in space ${spaceId}`);
            const availableIds = allModels.map(ct => `${ct.sys.id} (${ct.name})`).join(', ');
            if (availableIds) {
              console.warn(`Available model IDs: ${availableIds}`);
            }
            resolve({ items: [] });
          } else {
            resolve({ items: filteredModels });
          }
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

// Compare function
function compareModels(original, copy) {
  try {

    const modelComparison = {
      name: original.name,
      pilotId: original.sys.id,
      rolloutId: copy.sys.id,
      pilotName: original.name,
      rolloutName: copy.name,
      idMatch: original.sys.id === copy.sys.id,
      nameMatch: original.name === copy.name,
      fieldComparison: compareFields(original, copy),
      summary: generateSummary(original, copy)
    };
    
    // Add name mismatch to total issues if names don't match
    if (!modelComparison.nameMatch) {
      modelComparison.summary.totalIssues += 1;
      modelComparison.summary.nameMismatch = true;
    }
    
    return modelComparison;
  } catch (error) {
    throw error;
  }
}

// Compare fields between models
function compareFields(original, copy) {
  const originalMap = new Map(original.fields.map(f => [f.name, f.id]));
  const copyMap = new Map(copy.fields.map(f => [f.name, f.id]));

  const mismatches = [];
  const missingInCopy = [];
  const missingInOriginal = [];

  // Check fields in original
  original.fields.forEach(field => {
    if (copyMap.has(field.name)) {
      const copyId = copyMap.get(field.name);
      if (field.id !== copyId) {
        mismatches.push({
          name: field.name,
          originalId: field.id,
          copyId: copyId
        });
      }
    } else {
      missingInCopy.push(field.name);
    }
  });

  // Check for fields in copy that aren't in original
  copy.fields.forEach(field => {
    if (!originalMap.has(field.name)) {
      missingInOriginal.push(field.name);
    }
  });

  return {
    mismatches,
    missingInCopy,
    missingInOriginal,
    originalFieldCount: original.fields.length,
    copyFieldCount: copy.fields.length
  };
}

// Generate summary
function generateSummary(original, copy) {
  const comparison = compareFields(original, copy);
  const issues = comparison.mismatches.length + comparison.missingInCopy.length + comparison.missingInOriginal.length;
  return {
    totalIssues: issues,
    perfectMatch: issues === 0,
    mismatches: comparison.mismatches.length,
    missingInCopy: comparison.missingInCopy.length,
    extraInCopy: comparison.missingInOriginal.length
  };
}

// Extract dependencies from a content model
function extractDependencies(model) {
  const dependencies = new Set();
  
  if (!model.fields) return dependencies;
  
  model.fields.forEach(field => {
    // Check for Link type fields
    if (field.type === 'Link' && field.linkType === 'Entry') {
      // Check validations for specific content type references
      if (field.validations) {
        field.validations.forEach(validation => {
          if (validation.linkContentType) {
            validation.linkContentType.forEach(contentTypeId => {
              dependencies.add(contentTypeId);
            });
          }
        });
      }
    }
    
    // Check for Array of Links
    if (field.type === 'Array' && field.items) {
      if (field.items.type === 'Link' && field.items.linkType === 'Entry') {
        if (field.items.validations) {
          field.items.validations.forEach(validation => {
            if (validation.linkContentType) {
              validation.linkContentType.forEach(contentTypeId => {
                dependencies.add(contentTypeId);
              });
            }
          });
        }
      }
    }
  });
  
  return dependencies;
}

// Analyze all dependencies across models
function analyzeDependencies(models) {
  const dependencyMap = new Map();
  
  models.forEach(model => {
    const deps = extractDependencies(model);
    if (deps.size > 0) {
      dependencyMap.set(model.sys.id, {
        name: model.name,
        dependencies: Array.from(deps)
      });
    }
  });
  
  return dependencyMap;
}

// Suggest import order based on dependencies
function suggestImportOrder(models, missingInRollout) {
  const dependencyMap = analyzeDependencies(models);
  const missingIds = new Set(missingInRollout);
  
  // Build graph of missing models and their dependencies
  const graph = new Map();
  const inDegree = new Map();
  
  missingIds.forEach(id => {
    graph.set(id, []);
    inDegree.set(id, 0);
  });
  
  // Only consider dependencies between missing models
  missingIds.forEach(id => {
    const modelInfo = dependencyMap.get(id);
    if (modelInfo) {
      modelInfo.dependencies.forEach(depId => {
        if (missingIds.has(depId)) {
          graph.get(depId).push(id);
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
        }
      });
    }
  });
  
  // Topological sort (Kahn's algorithm)
  const queue = [];
  const result = [];
  
  inDegree.forEach((degree, id) => {
    if (degree === 0) {
      queue.push(id);
    }
  });
  
  while (queue.length > 0) {
    const current = queue.shift();
    result.push(current);
    
    const neighbors = graph.get(current) || [];
    neighbors.forEach(neighbor => {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    });
  }
  
  // If result doesn't contain all missing models, there might be circular dependencies
  if (result.length < missingIds.size) {
    // Add remaining models (possibly circular dependencies)
    missingIds.forEach(id => {
      if (!result.includes(id)) {
        result.push(id);
      }
    });
  }
  
  return result;
}

// Print comparison results
function printComparison(result, outputLines) {
  const { name, pilotId, rolloutId, pilotName, rolloutName, idMatch, nameMatch, fieldComparison, summary } = result;

  const lines = [];
  lines.push(`\n📋 Comparing: ${pilotName}`);
  
  // Show name comparison
  if (!nameMatch) {
    lines.push(`  ⚠️  NAME MISMATCH!`);
    lines.push(`  Pilot Name:   "${pilotName}"`);
    lines.push(`  Rollout Name: "${rolloutName}"`);
  }
  
  // Show ID comparison
  lines.push(`  Pilot ID:   ${pilotId}`);
  lines.push(`  Rollout ID: ${rolloutId}`);
  
  if (!idMatch) {
    lines.push(`  ⚠️  IDs don't match!`);
  } else {
    lines.push(`  ✅ IDs match`);
  }

  lines.push(`\n  📊 Fields:`);
  lines.push(`     Pilot:   ${fieldComparison.originalFieldCount}`);
  lines.push(`     Rollout: ${fieldComparison.copyFieldCount}`);

  if (fieldComparison.missingInCopy.length > 0) {
    lines.push(`  ❌ Missing in Rollout: ${fieldComparison.missingInCopy.length}`);
    fieldComparison.missingInCopy.forEach(name => lines.push(`     - ${name}`));
  }

  if (fieldComparison.mismatches.length > 0) {
    lines.push(`  ❌ ID Mismatches: ${fieldComparison.mismatches.length}`);
    fieldComparison.mismatches.forEach(match => {
      lines.push(`     - ${match.name}: ${match.originalId} → ${match.copyId}`);
    });
  }

  if (fieldComparison.missingInOriginal.length > 0) {
    lines.push(`  ⚠️  Extra in Rollout: ${fieldComparison.missingInOriginal.length}`);
    fieldComparison.missingInOriginal.forEach(name => lines.push(`     - ${name}`));
  }

  if (summary.perfectMatch && nameMatch) {
    lines.push(`  ✅ Perfect match!`);
  }

  // Print to console
  lines.forEach(line => console.log(line));
  
  // Add to output array
  lines.forEach(line => outputLines.push(line));

  return summary;
}

// Main function
async function main() {
  try {
    const outputLines = [];
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const outputFileName = `comparison-report_${dateStr}_${timeStr}.txt`;

    console.log('\n🚀 Starting Content Model Comparison');
    console.log(`📂 Using config: ${configPath}`);
    
    outputLines.push('═══════════════════════════════════════════════════════════');
    outputLines.push('           CONTENTFUL MODEL COMPARISON REPORT');
    outputLines.push('═══════════════════════════════════════════════════════════');
    outputLines.push(`Date: ${new Date().toLocaleString()}`);
    outputLines.push(`Config: ${configPath}`);
    outputLines.push('');

    // Get models to compare
    const modelsToCompare = config.modelsToCompare || [];
    
    if (modelsToCompare.length === 0) {
      console.log('\n⚠️  No models specified in config.modelsToCompare');
      console.log('Add model IDs to the config file to compare them.');
      process.exit(0);
    }

    console.log(`\n⏳ Fetching ${modelsToCompare.length} model(s) from Pilot space...`);

    const pilotModels = await fetchContentModels(
      config.spaces.pilot.spaceId,
      config.spaces.pilot.accessToken,
      modelsToCompare
    );

    console.log(`✅ Fetched ${pilotModels.items.length} model(s) from Pilot`);
    console.log(`⏳ Fetching ${modelsToCompare.length} model(s) from Rollout space...`);

    const rolloutModels = await fetchContentModels(
      config.spaces.rollout.spaceId,
      config.spaces.rollout.accessToken,
      modelsToCompare
    );

    console.log(`✅ Fetched ${rolloutModels.items.length} model(s) from Rollout`);

    console.log(`\n🔍 Comparing ${modelsToCompare.length} model(s)...\n`);
    console.log('='.repeat(60));
    
    outputLines.push(`Pilot Space ID: ${config.spaces.pilot.spaceId}`);
    outputLines.push(`Rollout Space ID: ${config.spaces.rollout.spaceId}`);
    outputLines.push(`Models to Compare: ${modelsToCompare.length}`);
    outputLines.push('');
    outputLines.push('='.repeat(60));

    let totalIssues = 0;
    const results = [];
    const missingModelIds = [];
    const missingModelNames = [];

    for (const modelId of modelsToCompare) {
      const pilotModel = pilotModels.items?.find(m => m.sys.id === modelId);
      const rolloutModel = rolloutModels.items?.find(m => m.sys.id === modelId);

      if (!pilotModel) {
        const msg = `\n❌ Model ID "${modelId}" not found in Pilot space`;
        console.log(msg);
        outputLines.push(msg);
        totalIssues++;
        continue;
      }

      if (!rolloutModel) {
        const msg = `\n❌ Model "${pilotModel.name}" (ID: ${modelId}) not found in Rollout space`;
        const warning = `   ⚠️  This model needs to be imported to Rollout`;
        console.log(msg);
        console.log(warning);
        outputLines.push(msg);
        outputLines.push(warning);
        totalIssues++;
        missingModelIds.push(modelId);
        missingModelNames.push(pilotModel.name);
        continue;
      }

      const comparison = compareModels(pilotModel, rolloutModel);
      printComparison(comparison, outputLines);
      totalIssues += comparison.summary.totalIssues;
      results.push(comparison);
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 SUMMARY');
    console.log(`   Total models compared: ${modelsToCompare.length}`);
    console.log(`   Total issues found: ${totalIssues}`);
    console.log(`   Perfect matches: ${results.filter(r => r.summary.perfectMatch && r.nameMatch).length}`);
    console.log(`   Name mismatches: ${results.filter(r => !r.nameMatch).length}\n`);

    outputLines.push('\n' + '='.repeat(60));
    outputLines.push('\n📊 SUMMARY');
    outputLines.push(`   Total models compared: ${modelsToCompare.length}`);
    outputLines.push(`   Total issues found: ${totalIssues}`);
    outputLines.push(`   Perfect matches: ${results.filter(r => r.summary.perfectMatch && r.nameMatch).length}`);
    outputLines.push(`   Name mismatches: ${results.filter(r => !r.nameMatch).length}`);

    // Dependency analysis and import order
    if (missingModelIds.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('\n🔗 DEPENDENCY ANALYSIS & SUGGESTED IMPORT ORDER');
      console.log(`\n   Models missing in Rollout: ${missingModelIds.length}\n`);
      
      outputLines.push('\n' + '='.repeat(60));
      outputLines.push('\n🔗 DEPENDENCY ANALYSIS & SUGGESTED IMPORT ORDER');
      outputLines.push(`\n   Models missing in Rollout: ${missingModelIds.length}\n`);

      // Analyze dependencies
      const dependencyMap = analyzeDependencies(pilotModels.items);
      
      // Show dependencies for missing models
      console.log('   Dependencies:');
      outputLines.push('   Dependencies:');
      
      missingModelIds.forEach(modelId => {
        const model = pilotModels.items.find(m => m.sys.id === modelId);
        const deps = dependencyMap.get(modelId);
        
        if (deps && deps.dependencies.length > 0) {
          const depNames = deps.dependencies.map(depId => {
            const depModel = pilotModels.items.find(m => m.sys.id === depId);
            return depModel ? `${depModel.name} (${depId})` : depId;
          }).join(', ');
          
          const line = `   - ${model.name} (${modelId}) depends on: ${depNames}`;
          console.log(line);
          outputLines.push(line);
        } else {
          const line = `   - ${model.name} (${modelId}) has no dependencies`;
          console.log(line);
          outputLines.push(line);
        }
      });

      // Suggest import order
      const importOrder = suggestImportOrder(pilotModels.items, missingModelIds);
      
      console.log('\n   📋 Suggested Import Order (import in this sequence):');
      outputLines.push('\n   📋 Suggested Import Order (import in this sequence):');
      
      importOrder.forEach((modelId, index) => {
        const model = pilotModels.items.find(m => m.sys.id === modelId);
        const line = `   ${index + 1}. ${model.name} (${modelId})`;
        console.log(line);
        outputLines.push(line);
      });
      
      console.log('\n   ℹ️  Import models from top to bottom to handle dependencies correctly.\n');
      outputLines.push('\n   ℹ️  Import models from top to bottom to handle dependencies correctly.\n');
    }

    outputLines.push('');
    outputLines.push('═══════════════════════════════════════════════════════════');
    outputLines.push('                    END OF REPORT');
    outputLines.push('═══════════════════════════════════════════════════════════');

    // Write to file
    fs.writeFileSync(outputFileName, outputLines.join('\n'), 'utf8');
    console.log(`\n✅ Report saved to: ${outputFileName}\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
