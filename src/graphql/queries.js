export const listExercises = /* GraphQL */ `
  query ListExercises($limit: Int, $nextToken: String) {
    listExercises(limit: $limit, nextToken: $nextToken) {
      items {
        exercise_id
        name
        category
        instructions
        equipment_required
        exercise_image
        muscle_group
      }
      nextToken
    }
  }
`;

export const getExerciseQuery = /* GraphQL */ `
  query GetExercise($exercise_id: ID!) {
    getExercise(exercise_id: $exercise_id) {
      exercise_id
      name
      category
      instructions
      equipment_required
      exercise_image
      muscle_group
    }
  }
`;

export const listWorkoutsByCustomer = /* GraphQL */ `
  query ListWorkoutsByCustomer($customer_id: ID!, $limit: Int, $nextToken: String) {
    listWorkoutsByCustomer(customer_id: $customer_id, limit: $limit, nextToken: $nextToken) {
      workout_id customer_id name created_at updated_at
    }
  }
`;

export const listWorkoutItemsByWorkout = /* GraphQL */ `
  query ListWorkoutItemsByWorkout($workout_id: ID!, $limit: Int, $nextToken: String) {
    listWorkoutItems(workout_id: $workout_id, limit: $limit, nextToken: $nextToken) {
      workout_id
      workout_item_index
      exercise_id
      muscle_focus
      target_sets
      target_reps
      target_tot
      target_tut
      target_velocity
      target_weight
      created_at
      updated_at
    }
  }
`;

export const listSessionsByCustomerQuery = /* GraphQL */ `
  query ListSessionsByCustomer($customer_id: ID!, $limit: Int, $nextToken: String) {
    listSessionsByCustomer(customer_id: $customer_id, limit: $limit, nextToken: $nextToken) {
      session_id
      workout_id
      workout_date
      created_at
      updated_at
    }
  }
`;

export const listSessionItemsBySession = /* GraphQL */ `
  query ListSessionItemsBySession($session_id: ID!, $limit: Int, $nextToken: String) {
    listSessionItemsBySession(session_id: $session_id, limit: $limit, nextToken: $nextToken) {
      session_id
      session_item_index
      workout_id
      workout_index
      exercise_id
      muscle_focus
      created_at
      updated_at
    }
  }
`;

export const listSessionItemSetsQuery = /* GraphQL */ `
  query ListSessionItemSets(
    $session_id: ID!
    $session_item_index: Int!
    $limit: Int
    $nextToken: String
  ) {
    listSessionItemSets(
      session_id: $session_id
      session_item_index: $session_item_index
      limit: $limit
      nextToken: $nextToken
    ) {
      session_id
      session_item_index
      session_item_set_index
      weight_lifted
      created_at
      updated_at
    }
  }
`;

export const listSessionItemRepsQuery = /* GraphQL */ `
  query ListSessionItemReps($session_id: ID!, $limit: Int, $nextToken: String) {
    listSessionItemReps(session_id: $session_id, limit: $limit, nextToken: $nextToken) {
      items {
        session_id
        session_item_index
        session_item_set_index
        session_item_rep_index
        tut
        velocity
        momentum
        score
        rom
        created_at
        updated_at
      }
      nextToken
    }
  }
`;

export const getUser = /* GraphQL */ `
  query GetUser($user_id: ID!) {
    getUser(user_id: $user_id) {
      user_id email first_name last_name city state fitness_goal workout_location
    }
  }
`;
