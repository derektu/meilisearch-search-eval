/** Pinned community assets from the primary GitHub release API, not enterprise assets. */
export const OFFICIAL_RELEASE = Object.freeze({
  version: '1.53.2',
  tag: 'v1.53.2',
  releaseId: 384016285,
  publishedAt: '2026-09-07T10:48:03Z',
  releaseUrl: 'https://github.com/meilisearch/meilisearch/releases/tag/v1.53.2',
  metadataUrl: 'https://api.github.com/repos/meilisearch/meilisearch/releases/tags/v1.53.2',
});
const asset = (platform, arch, id, name, bytes, sha256) => Object.freeze({
  platform, arch, id, name, bytes, sha256,
  url: `https://github.com/meilisearch/meilisearch/releases/download/${OFFICIAL_RELEASE.tag}/${name}`,
});
export const OFFICIAL_ASSETS = Object.freeze({
  'darwin-arm64': asset('darwin', 'arm64', 548649765, 'meilisearch-macos-apple-silicon', 341683536, '7fa492746343c1dd7217ead82fc6d42e74c1304593e4604f52ca71cf44d61b28'),
  'linux-arm64': asset('linux', 'arm64', 548642674, 'meilisearch-linux-aarch64', 344482208, '12a38c387953e61807a5a0deb64e4bf52def38e49872c7963949a7d4d41a2117'),
  'linux-x64': asset('linux', 'x64', 548642004, 'meilisearch-linux-amd64', 350342528, '6c00019a887813ccbce54eec52718c9343bf4234383871146c67c76b1d2646cd'),
  'linux-riscv64': asset('linux', 'riscv64', 548647702, 'meilisearch-linux-riscv64', 343403256, 'ae946052b76833e7173853021f97428ee3cbfaf7977855b1b25962d0bf098621'),
  'win32-x64': asset('win32', 'x64', 548655591, 'meilisearch-windows-amd64.exe', 346635776, 'edb04f8288565e413a318069600954e38574714e5a2559777f8f4e8cc16d1bf3'),
});

export function officialReleaseAsset({ platform = process.platform, arch = process.arch } = {}) {
  const result = OFFICIAL_ASSETS[`${platform}-${arch}`];
  if (!result) {
    throw new Error(`Official community Meilisearch ${OFFICIAL_RELEASE.version} has no pinned asset for ${platform}/${arch}; no enterprise or source-build fallback is used. See ${OFFICIAL_RELEASE.releaseUrl}`);
  }
  return result;
}

export function assertOfficialBinaryIdentity({ sha256, platform = process.platform, arch = process.arch }) {
  const selected = officialReleaseAsset({ platform, arch });
  if (sha256 !== selected.sha256) {
    throw new Error(`B0/B1 require the official community Meilisearch ${OFFICIAL_RELEASE.version} ${selected.name} (SHA-256 ${selected.sha256}); received ${sha256}. Run npm run engine:download and use .cache/engines/meilisearch-official${platform === 'win32' ? '.exe' : ''}, or select C1 for a source-built Chinese-only control.`);
  }
  return {
    distribution: 'official-release', version: OFFICIAL_RELEASE.version,
    platform, arch, verified: true, asset: selected.name, assetId: selected.id,
    sha256: selected.sha256, expectedBytes: selected.bytes,
    releaseUrl: OFFICIAL_RELEASE.releaseUrl, assetUrl: selected.url,
  };
}
