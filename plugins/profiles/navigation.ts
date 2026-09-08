export function destinationUrl(remoteUrl: string, localUrl: string, currentHostname: string): string {
  return ["localhost", "127.0.0.1", "[::1]"].includes(currentHostname) ? localUrl : remoteUrl;
}
