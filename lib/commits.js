const log = require('./log')
const paginate = require('./pagination')
const _ = require('lodash')

module.exports.findCommitsWithAssociatedPullRequestsQuery = ({
  paths,
}) => /* GraphQL */ `
  query findCommitsWithAssociatedPullRequests(
    $name: String!
    $owner: String!
    $ref: String!
    $withPullRequestBody: Boolean!
    $withPullRequestURL: Boolean!
    $since: GitTimestamp
    $after: String
  ) {
    repository(name: $name, owner: $owner) {
      object(expression: $ref) {
        ... on Commit {
          history(first: 100, since: $since, after: $after) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              committedDate
              message
              author {
                name
                user {
                  login
                }
              }
              associatedPullRequests(first: 5) {
                nodes {
                  title
                  number
                  url @include(if: $withPullRequestURL)
                  body @include(if: $withPullRequestBody)
                  author {
                    login
                  }
                  baseRepository {
                    nameWithOwner
                  }
                  mergedAt
                  isCrossRepository
                  labels(first: 10) {
                    nodes {
                      name
                    }
                  }
                }
              }
              ${paths
                .map(
                  (path, idx) => `
              path${idx}: history(path: "${path}") {
                totalCount
              }
              `
                )
                .join('\n')}
            }
          }
        }
      }
    }
  }
`

module.exports.findCommitsWithAssociatedPullRequests = async ({
  context,
  ref,
  lastRelease,
  config,
  paths,
}) => {
  const { owner, repo } = context.repo()
  const variables = {
    name: repo,
    owner,
    ref,
    withPullRequestBody: config['change-template'].includes('$BODY'),
    withPullRequestURL: config['change-template'].includes('$URL'),
  }
  const dataPath = ['repository', 'object', 'history']
  const repoNameWithOwner = `${owner}/${repo}`

  let allCommits

  if (lastRelease) {
    log({
      context,
      message: `Fetching all commits for reference ${ref} since ${lastRelease.created_at}`,
    })

    try {
      const data = await paginate(
        context.octokit.graphql,
        module.exports.findCommitsWithAssociatedPullRequestsQuery({ paths }),
        { ...variables, since: lastRelease.created_at },
        dataPath
      )
      // GraphQL call is inclusive of commits from the specified dates.  This means the final
      // commit from the last tag is included, so we remove this here.
      allCommits = _.filter(
        _.get(data, [...dataPath, 'nodes']),
        (commit) => commit.committedDate != lastRelease.created_at
      )
    } catch (e) {
      log({ context, message: `Exception during GraphQL, suppressing: ${e}` })
      allCommits = []
    }
  } else {
    log({ context, message: `Fetching all commits for reference ${ref}` })

    const data = await paginate(
      context.octokit.graphql,
      module.exports.findCommitsWithAssociatedPullRequestsQuery({ paths }),
      variables,
      dataPath
    )
    allCommits = _.get(data, [...dataPath, 'nodes'])
  }

  const containsChangedTrees = (commit) => {
    var changed = false
    paths.forEach((path, idx) => {
      let { totalCount } = commit[`path${idx}`]
      log({
        context,
        message: `  containsChangedTrees: ${commit.message}: ${totalCount}`,
      })
      changed = changed || totalCount > 0
    })

    return changed
  }

  const commits = paths.length
    ? allCommits.filter(containsChangedTrees)
    : allCommits

  log({
    context,
    message: `Filtered: paths.length: ${paths.length}, all: ${allCommits.length}, filtered: ${commits.length}`,
  })

  const pullRequests = _.uniqBy(
    _.flatten(commits.map((commit) => commit.associatedPullRequests.nodes)),
    'number'
  ).filter((pr) => pr.baseRepository.nameWithOwner === repoNameWithOwner)

  return { commits, pullRequests }
}
