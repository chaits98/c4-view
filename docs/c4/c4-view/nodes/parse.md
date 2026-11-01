# model

Reads the file, validates every key, and refuses with a message naming the file and the key. It is the only place that decides a model is well-formed, so everything downstream may assume it.
