# argv

Turns a command line into exactly one action, and rejects a bad invocation before doing any work. Exit codes are the contract: `0` clean, `1` a gate failed, `2` unusable invocation.
