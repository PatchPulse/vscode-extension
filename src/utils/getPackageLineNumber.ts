interface GetPackageLineNumberArgs {
  packageJsonDocumentText: string;
  packageName: string;
}

export function getPackageLineNumber({
  packageJsonDocumentText,
  packageName,
}: GetPackageLineNumberArgs): number {
  const lines = packageJsonDocumentText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(`"${packageName}": "`)) {
      return i;
    }
  }

  return -1;
}
