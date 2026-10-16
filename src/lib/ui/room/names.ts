/** "The Warden" is shown on a medallion as "W": the article is not part of a name's initials. */
export const withoutArticle = (name: string) => name.replace(/^(the|a|an)\s+/i, '');
