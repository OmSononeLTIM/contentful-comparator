# Contentful Model Comparator

A self-sufficient Node.js tool to compare Contentful content models between spaces. Perfect for syncing models from Pilot to Rollout environments with dependency-aware import ordering.

## Features

- ✅ Export content models directly from Contentful spaces via API
- ✅ Compare specific models between any two spaces (by ID)
- ✅ **Import content models** - create or update models from Pilot to Rollout
- ✅ **Count content models** - check usage against 300 model limit
- ✅ **Find cleanup candidates** - identify models to remove from Rollout
- ✅ **Space availability analysis** - plan cleanup and imports
- ✅ Field-by-field comparison with detailed reports
- ✅ Detect name mismatches (same ID, different names)
- ✅ Identify missing fields, extra fields, and ID mismatches
- ✅ **Dependency analysis** - detects which models reference others
- ✅ **Smart import ordering** - suggests correct sequence to import models
- ✅ **Dry-run mode** - preview changes before executing
- ✅ Automated report generation with timestamps
- ✅ Environment variable support for credentials
- ✅ Multi-environment support (master, staging, etc.)
- ✅ Config-driven workflow (no command-line arguments needed)

## Installation

```bash
npm install
```

## Setup

1. **Configure your spaces** - Edit `config.json` with your Contentful credentials:

```json
{
  "spaces": {
    "pilot": {
      "spaceId": "your_pilot_space_id",
      "accessToken": "your_pilot_management_token"
    },
    "rollout": {
      "spaceId": "your_rollout_space_id",
      "accessToken": "your_rollout_management_token"
    }
  },
  "modelsToCompare": [
    "productOverview",
    "productVariant",
    "blogPost"
  ]
}
```

2. **Configuration details**:
   - `spaceId`: Your Contentful space ID
   - `accessToken`: Contentful Management API (CMA) token (⚠️ keep private!)
   - `modelsToCompare`: Array of content model IDs for comparison operations
   - `modelsToImport`: Array of content model IDs specifically for import operations (optional)

## Usage

### Compare Content Models

```bash
npm start
```

Runs comparison using `config.json` and generates a timestamped report file.

### Count Content Models

Check how many content models exist in a space (Contentful has a limit of 300 per space):

```bash
# Count models in Pilot space
npm run count-pilot

# Count models in Rollout space
npm run count-rollout

# Or count any space directly
node count-models.js <spaceId> <accessToken> [spaceName]
```

**Output includes:**
- Total model count vs. 300 limit
- Remaining capacity
- Usage percentage with visual bar
- Warning when approaching limit
- Complete list of all models

### Find Models to Clean Up

Identify models that exist in Rollout but not in Pilot (candidates for removal):

```bash
npm run cleanup
```

**This command:**
- Fetches ALL models from both Pilot and Rollout spaces
- Identifies models unique to Rollout (can be removed to free space)
- Identifies models unique to Pilot (need to be imported)
- Shows space availability analysis
- Calculates if cleanup will free enough space for new imports
- Saves results to timestamped file: `cleanup-analysis_YYYY-MM-DD_HH-MM-SS.txt`

**Perfect for:**
- Freeing up space when approaching the 300 model limit
- Ensuring Rollout only has models that exist in Pilot
- Planning space cleanup before importing new models

### Import Content Models

Import content models from Pilot to Rollout space:

```bash
# Interactive mode - choose model from list
npm run import

# Import models from modelsToImport array in config.json
npm run import:config

# Dry run - preview import from config without making changes
npm run import:config:dry-run

# Import specific model by ID
node import-models.js productOverview

# Import all models from modelsToCompare array
npm run import:all

# Dry run - preview without making changes
npm run import:dry-run modelId
node import-models.js --dry-run --all
node import-models.js --from-config --dry-run
```

**How it works:**
1. Fetches the content model from Pilot space
2. Checks if it exists in Rollout space
3. Creates new model or updates existing model
4. Publishes the model to make it available
5. Handles field additions, removals, and updates

**Configuration:**
- Add models to `modelsToImport` array in config.json for dedicated import list
- Or use `modelsToCompare` array with `--all` flag
- Interactive mode shows all available models from both arrays

**Example config.json:**
```json
{
  "modelsToCompare": ["productOverview", "blogPost"],
  "modelsToImport": ["homepageHero", "appCarouselBannerBlock"]
}
```

**Important features:**
- ⚠️ **Dry run mode** - Preview changes without executing them
- 🔒 **Environment-aware** - Uses PILOT_ENVIRONMENT and ROLLOUT_ENVIRONMENT from .env
- 🔄 **Update or Create** - Automatically detects if model exists
- 📊 **Detailed output** - Shows field changes, versions, and status
- 🚦 **Rate limiting** - Adds delays between bulk imports

**Safety notes:**
- Always use `--dry-run` first to preview changes
- Importing will overwrite existing models with the same ID
- Make sure dependencies are imported first (use comparison tool to check)
- Default environment is "master" if not specified in .env

**Workflow example:**
```bash
# 1. Add models you want to import to config.json
#    Edit "modelsToImport": ["homepageHero", "productCard"]

# 2. Preview the import (safe - no changes made)
npm run import:config:dry-run

# 3. Review the output, then execute the import
npm run import:config

# 4. Verify the import succeeded in Contentful UI
```

### Custom Config File

```bash
node compare-models.js ./path/to/custom-config.json
```

## Output

### Console Output

The script provides real-time comparison results in the console:

```
🚀 Starting Content Model Comparison
📂 Using config: ./config.json

⏳ Fetching 15 model(s) from Pilot space...
✅ Fetched 15 model(s) from Pilot
⏳ Fetching 15 model(s) from Rollout space...
✅ Fetched 10 model(s) from Rollout

🔍 Comparing 15 model(s)...

============================================================

📋 Comparing: Product Overview
  Pilot ID:   productOverview
  Rollout ID: productOverview
  ✅ IDs match

  📊 Fields:
     Pilot:   48
     Rollout: 46
  ❌ Missing in Rollout: 2
     - Comparison Chart
     - DTC Bundle

❌ Model "Product Variant Block" (ID: productVariantBlock) not found in Rollout space
   ⚠️  This model needs to be imported to Rollout

📋 Comparing: DTC - In the box
  ⚠️  NAME MISMATCH!
  Pilot Name:   "DTC - In the box"
  Rollout Name: "In the box"
  Pilot ID:   inTheBox
  Rollout ID: inTheBox
  ✅ IDs match
```

### Dependency Analysis

When models are missing in Rollout, the script analyzes dependencies and suggests import order:

```
🔗 DEPENDENCY ANALYSIS & SUGGESTED IMPORT ORDER

   Models missing in Rollout: 5

   Dependencies:
   - Product Card (productCard) has no dependencies
   - Video Block (videoBlock) has no dependencies
   - Product Overview (productOverview) depends on: Product Variant (productVariant)
   - Carousel Block (carouselBlock) depends on: Product Card (productCard)
   - Homepage Hero (homepageHero) depends on: Video Block (videoBlock)

   📋 Suggested Import Order (import in this sequence):
   1. Product Card (productCard)
   2. Video Block (videoBlock)
   3. Product Variant (productVariant)
   4. Product Overview (productOverview)
   5. Carousel Block (carouselBlock)
   6. Homepage Hero (homepageHero)

   ℹ️  Import models from top to bottom to handle dependencies correctly.
```

### Summary Report

```
📊 SUMMARY
   Total models compared: 15
   Total issues found: 8
   Perfect matches: 10
   Name mismatches: 1
```

### Report Files

Each run generates a timestamped report file:
- Format: `comparison-report_YYYY-MM-DD_HH-MM-SS.txt`
- Example: `comparison-report_2026-03-24_14-30-15.txt`
- Contains complete comparison details including dependencies

## How It Works

1. **Fetches models** from both spaces using Contentful Management API
2. **Compares field-by-field** - names, IDs, counts, and types
3. **Detects name mismatches** - catches when model names differ but IDs match
4. **Analyzes dependencies** - examines Link and Array fields to find references
5. **Calculates import order** - uses topological sorting to determine correct sequence
6. **Generates reports** - saves detailed comparison to timestamped text file

## Security

⚠️ **Important**: Never commit credentials to version control!

### Environment Variables (Recommended)

For better security, use a `.env` file instead of storing credentials in `config.json`:

1. Create a `.env` file in the project root:
```env
PILOT_SPACE_ID=your_pilot_space_id
PILOT_ACCESS_TOKEN=your_pilot_access_token
PILOT_ENVIRONMENT=master

ROLLOUT_SPACE_ID=your_rollout_space_id
ROLLOUT_ACCESS_TOKEN=your_rollout_access_token
ROLLOUT_ENVIRONMENT=master
```

2. Environment variables override values in `config.json`
3. `.env` file is automatically ignored by git
4. Use `.env.example` as a template

**Environment variable precedence:**
- `PILOT_SPACE_ID` overrides `config.spaces.pilot.spaceId`
- `PILOT_ACCESS_TOKEN` overrides `config.spaces.pilot.accessToken`
- `PILOT_ENVIRONMENT` sets the Contentful environment (defaults to "master")
- Same for `ROLLOUT_*` variables

### Best Practices

- Keep `config.json` for model IDs only (remove credentials)
- Use `.env` for all sensitive tokens and space IDs
- Never commit `.env` to version control
- Use environment variables for CI/CD pipelines
- Rotate access tokens regularly

## Troubleshooting

### Model not found errors
- Ensure you're using model **IDs** (e.g., `productOverview`) not names (e.g., `Product Overview`)
- Check that the model exists in the Pilot space
- Verify your access token has read permissions

### Finding Model IDs
Model IDs are shown in Contentful's web UI:
- Go to Content Model > Click a model
- The ID is in the URL: `...content_types/productOverview/...`
- Or run the script with an invalid ID to see all available IDs

## Current Capabilities

- ✅ Compare content models between two Contentful spaces
- ✅ Count content models and check usage against 300 limit
- ✅ Find models to remove (exist in Rollout but not in Pilot)
- ✅ **Import models from Pilot to Rollout** - create or update models
- ✅ Analyze space availability for imports
- ✅ Identify missing and mismatched fields
- ✅ Detect model name mismatches
- ✅ Analyze dependencies between models
- ✅ Suggest correct import order
- ✅ Generate detailed timestamped reports
- ✅ Environment variable support for credentials
- ✅ Environment-aware operations (master, staging, etc.)
- ✅ Dry-run mode for safe testing
- ✅ Interactive model selection

## Future Enhancements

- Batch field updates for existing models
- Validation type comparison (required, unique, etc.)
- Export dependency graph visualization
- Automatic dependency resolution during import
- Content migration (entries, not just models)
- Rollback capabilities

## License

MIT
