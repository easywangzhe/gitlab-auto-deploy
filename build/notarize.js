/**
 * Notarize macOS application
 * This script runs after signing the app
 *
 * Prerequisites:
 * 1. Apple Developer account
 * 2. App-specific password stored in APPLE_APP_SPECIFIC_PASSWORD
 * 3. Apple ID stored in APPLE_ID
 * 4. Team ID stored in APPLE_TEAM_ID
 */

const { notarize } = require('@electron/notarize')
const path = require('path')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context

  // Only notarize on macOS
  if (electronPlatformName !== 'darwin') {
    return
  }

  // Skip notarization if credentials are not set
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization: Apple credentials not set')
    console.log('To enable notarization, set these environment variables:')
    console.log('  - APPLE_ID: Your Apple ID email')
    console.log('  - APPLE_APP_SPECIFIC_PASSWORD: App-specific password from appleid.apple.com')
    console.log('  - APPLE_TEAM_ID: Your team ID from developer.apple.com')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  console.log(`Notarizing ${appPath}...`)

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    })
    console.log('Notarization complete!')
  } catch (error) {
    console.error('Notarization failed:', error.message)
    // Don't fail the build if notarization fails
    // throw error
  }
}