// If a field isn't in your backend yet, add a resolver/mutation in AppSync first.

export const createUser = /* GraphQL */ `
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      user_id email first_name last_name role city state
      current_weight height_inches fitness_goal workout_location
      created_at updated_at
    }
  }
`;

export const createCustomer = /* GraphQL */ `
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) {
      customer_id user_id preferred_workout_location fitness_focus
      created_at updated_at
    }
  }
`;

export const createWorkout = /* GraphQL */ `
  mutation CreateWorkout($input: CreateWorkoutInput!) {
    createWorkout(input: $input) {
      workout_id customer_id trainer_id name created_at updated_at
    }
  }
`;

export const createWorkoutItem = /* GraphQL */ `
  mutation CreateWorkoutItem($input: CreateWorkoutItemInput!) {
    createWorkoutItem(input: $input) {
      workout_id workout_item_index exercise_id muscle_focus
      target_sets target_reps target_tot target_velocity target_weight
      created_at updated_at
    }
  }
`;

export const createSession = /* GraphQL */ `
  mutation CreateSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      session_id customer_id workout_id workout_date created_at updated_at
    }
  }
`;

export const createSessionItem = /* GraphQL */ `
  mutation CreateSessionItem($input: CreateSessionItemInput!) {
    createSessionItem(input: $input) {
      session_id session_item_index workout_id workout_index exercise_id muscle_focus
    }
  }
`;

export const createSessionItemSet = /* GraphQL */ `
  mutation CreateSessionItemSet($input: CreateSessionItemSetInput!) {
    createSessionItemSet(input: $input) {
      session_id session_item_index session_item_set_index weight_lifted
    }
  }
`;

export const createSessionItemRep = /* GraphQL */ `
  mutation CreateSessionItemRep($input: CreateSessionItemRepInput!) {
    createSessionItemRep(input: $input) {
      session_id session_item_index session_item_set_index session_item_rep_index
      tut velocity momentum score rom
    }
  }
`;
