# Reproducible TypeScript → WASI component toolchain for perfscale libraries.
#
# The image carries Node 24 plus the published @perfscale/library-sdk (jco
# componentize included), so library builds are hermetic — no host Node, no
# global installs, same result on every machine.
#
# Build:
#   docker build -t perfscale-library-build ts/docker
#
# Use (run from your library's directory):
#   docker run --rm -v "$PWD:/src" -w /src perfscale-library-build mylib.ts -o mylib.wasm
#
# Pin the SDK version at build time:
#   docker build --build-arg SDK_VERSION=0.1.1 -t perfscale-library-build ts/docker

FROM node:24-slim

ARG SDK_VERSION=0.1.2
RUN npm install -g "@perfscale/library-sdk@${SDK_VERSION}" \
  && npm cache clean --force \
  # Library sources mounted at /src import "@perfscale/library-sdk" by name;
  # the walk-up from /src reaches /node_modules, which we point at the global
  # install so those imports resolve inside the container.
  && ln -s /usr/local/lib/node_modules /node_modules

# The CLI's only contract: an entry file in, a component out (see --help).
ENTRYPOINT ["perfscale-library-build"]
