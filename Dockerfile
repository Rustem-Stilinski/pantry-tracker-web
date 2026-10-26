# Build the Angular app, then serve it with nginx, which also forwards /api to the backend.
#   docker build -t pantry-tracker-web .
#   docker run -p 4200:80 -e API_URL=http://host.docker.internal:8080 pantry-tracker-web
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build

FROM nginx:1.27-alpine
ENV API_URL=http://api:8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
