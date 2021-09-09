const semver = require('semver')

const splitSemVer = (input, versionKey = 'version') => {
  if (!input[versionKey]) {
    return null
  }

  const version = input.inc
    ? semver.inc(input[versionKey], input.inc, true)
    : semver.parse(input[versionKey])

  return {
    ...input,
    version,
    $MAJOR: semver.major(version),
    $MINOR: semver.minor(version),
    $PATCH: semver.patch(version),
  }
}

const getTemplatableVersion = (input) => {
  const templatableVersion = {
    $NEXT_MAJOR_VERSION: splitSemVer({ ...input, inc: 'major' }),
    $NEXT_MINOR_VERSION: splitSemVer({ ...input, inc: 'minor' }),
    $NEXT_PATCH_VERSION: splitSemVer({ ...input, inc: 'patch' }),
    $INPUT_VERSION: splitSemVer(input, 'inputVersion'),
    $RESOLVED_VERSION: splitSemVer({
      ...input,
      inc: input.versionKeyIncrement || 'patch',
    }),
  }

  templatableVersion.$RESOLVED_VERSION =
    templatableVersion.$INPUT_VERSION || templatableVersion.$RESOLVED_VERSION

  return templatableVersion
}

const coerceVersion = (input, tagPrefix) => {
  if (!input) {
    return null
  }

  const stripTag = (input) =>
    tagPrefix && input.startsWith(tagPrefix)
      ? input.substr(tagPrefix.length)
      : input

  return typeof input === 'object'
    ? semver.coerce(stripTag(input.tag_name)) ||
        semver.coerce(stripTag(input.name))
    : semver.coerce(stripTag(input))
}

module.exports.getVersionInfo = (
  release,
  template,
  inputVersion = null,
  versionKeyIncrement = null,
  tagPrefix = null
) => {
  const version = coerceVersion(release, tagPrefix)
  inputVersion = coerceVersion(inputVersion, tagPrefix)

  if (!version && !inputVersion) {
    return undefined
  }

  return {
    ...getTemplatableVersion({
      version,
      template,
      inputVersion,
      versionKeyIncrement,
    }),
  }
}
