FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./

RUN yarn install

COPY . .

RUN yarn add global terser
COPY .settings.json ./
COPY polyfil/package.json ./node_modules/@raydium-io/raydium-sdk
RUN yarn run build

RUN find ./dist -name "*.js" -type f -exec bash -c 'file="{}"; newfile="${file%.js}.js";yarn terser "$file" -o "$newfile" --compress --mangle' \;

CMD ["node", "./dist/index.js"]


