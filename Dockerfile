ARG BASE=alpine:latest
FROM $BASE AS builder

RUN apk add --no-cache \
    git \
    nodejs \
    npm

# setup repo
#RUN git clone https://github.com/jcolson/irslackd /irslackd
COPY . /irslackd

# install
RUN cd /irslackd && npm install

# runtime image
FROM $BASE

RUN apk add --no-cache \
    nodejs

COPY --from=builder /irslackd /irslackd

#HEALTHCHECK CMD wget --quiet --tries=1 --spider http://localhost:8080/metrics || exit 1
# needs volume set: /root/.irslackd also needs port set 6699
# export VOLUME=/Users/jcolson/.irslackd
# docker run --network quassel-net --name irslackd -d -v ${VOLUME}:/root/.irslackd -p 6696:6696 karmanet/irslackd:latest
CMD cd /irslackd && ./irslackd -p 6696 -a 0.0.0.0