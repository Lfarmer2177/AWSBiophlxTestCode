export const listExercises = /* GraphQL */ `
  query ListExercises($limit: Int, $nextToken: String) {
    listExercises(limit: $limit, nextToken: $nextToken) {
      items { exercise_id name category muscle_groups equipment_required instructions exercise_profile_id }
      nextToken
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

export const getUser = /* GraphQL */ `
  query GetUser($user_id: ID!) {
    getUser(user_id: $user_id) {
      user_id email first_name last_name city state fitness_goal workout_location
    }
  }
`;
