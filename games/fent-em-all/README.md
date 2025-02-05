# Game One

This is the first game of the Euclid games pack, inspired by our experiences living in downtown Toronto. 

## Domain

- `domain/models`: Entities, Value Objects, Aggregates
- `domain/services`: Domain services unique to this game
- `domain/events`: Domain events for event-driven architecture

## Application

- `application/services`: Application-level use cases
- `application/dto`: Data transfer objects

## Infrastructure

- `infrastructure/repositories`: Persistence logic
- `infrastructure/adapters`: External service integrations or gateways

## Interfaces

- UI or presentation layer (console, web, game engine hooks, etc.)

## Tests

- Unit tests, integration tests, etc.


## Versioning on server
-- npm : 10.9.2
-- node: 22.13.1
-- socket.io: 4.8.1
-- express: 4.21.2