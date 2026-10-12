FROM node:22.22.0-alpine
WORKDIR /qa
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages ./packages
COPY runner ./runner
COPY config ./config
USER node
CMD ["node", "--experimental-strip-types", "--experimental-transform-types", "runner/main.ts"]
