const log = require('./log')
const paginate = require('./pagination')
const _ = require('lodash')

module.exports.findCommitsWithAssociatedPullRequestsQuery = ({
  includePaths,
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
          ${includePaths
            .map(
              (path, idx) => `\
          path${idx}: history(path: "${path}", since: $since, after: $after) {
            nodes {
              id
            }
          }
          `
            )
            .join('\n')}

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
  includePaths,
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

  let data,
    allCommits,
    includedIds = {}

  if (lastRelease) {
    log({
      context,
      message: `Fetching all commits for reference ${ref} since ${lastRelease.created_at}`,
    })

    data = await paginate(
      context.octokit.graphql,
      module.exports.findCommitsWithAssociatedPullRequestsQuery({
        includePaths,
      }),
      { ...variables, since: lastRelease.created_at },
      dataPath
    )
    // GraphQL call is inclusive of commits from the specified dates.  This means the final
    // commit from the last tag is included, so we remove this here.
    allCommits = _.get(data, [...dataPath, 'nodes']).filter(
      (commit) => commit.committedDate != lastRelease.created_at
    )
  } else {
    log({ context, message: `Fetching all commits for reference ${ref}` })

    data = await paginate(
      context.octokit.graphql,
      module.exports.findCommitsWithAssociatedPullRequestsQuery({
        includePaths,
      }),
      variables,
      dataPath
    )
    allCommits = _.get(data, [...dataPath, 'nodes'])
  }

  includePaths.forEach((path, idx) => {
    const { nodes } = _.get(data, ['repository', 'object', `path${idx}`])
    includedIds[path] = includedIds[path] || new Set([])
    nodes.forEach(({ id }) => {
      includedIds[path].add(id)
    })
  })

  const containsChangedTrees = (commit) =>
    Boolean(includePaths.find((path) => includedIds[path].has(commit.id)))

  const commits = includePaths.length
    ? allCommits.filter(containsChangedTrees)
    : allCommits

  const pullRequests = _.uniqBy(
    _.flatten(commits.map((commit) => commit.associatedPullRequests.nodes)),
    'number'
  ).filter((pr) => pr.baseRepository.nameWithOwner === repoNameWithOwner)

  return { commits, pullRequests }
}
