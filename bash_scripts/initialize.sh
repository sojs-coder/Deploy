#!/bin/bash

## INSTALL DOCKER ===
sudo snap install docker


# install 
wget -O image https://deploy.sojs.dev/image/$1?token=$2


docker load -i image

docker run -d -p 80:80 708504602187.dkr.ecr.us-west-1.amazonaws.com/deploy:$1