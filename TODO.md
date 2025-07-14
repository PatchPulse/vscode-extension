1. Cache the latest versions of packages as we fetch them. i.e. save timestamp
2. Use cache instead of fetching if the cache is still valid. i.e. if timestamp is less than 1 hour old
3. Debounce decoration updates (maybe once per second?)
